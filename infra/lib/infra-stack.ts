import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';
import * as path from 'node:path';
import * as fs from 'node:fs';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope,id,props);
    const extensionId = (this.node.tryGetContext('extensionId') || JSON.parse(fs.readFileSync(path.join(__dirname,'../../config/extension.json'),'utf8')).id) as string | undefined;
    if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) throw new Error('Pass -c extensionId=<stable Chrome extension ID>');
    const videoBucket=new s3.Bucket(this,'VideosBucket',{
      blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,encryption:s3.BucketEncryption.S3_MANAGED,enforceSSL:true,removalPolicy:cdk.RemovalPolicy.RETAIN,
      cors:[{allowedMethods:[s3.HttpMethods.GET,s3.HttpMethods.HEAD,s3.HttpMethods.PUT],allowedOrigins:[`chrome-extension://${extensionId}`],allowedHeaders:['*'],exposedHeaders:['ETag'],maxAge:3600}],
      lifecycleRules:[{abortIncompleteMultipartUploadAfter:cdk.Duration.days(1)},{transitions:[{storageClass:s3.StorageClass.INTELLIGENT_TIERING,transitionAfter:cdk.Duration.days(30)}]}],
    });
    const siteBucket=new s3.Bucket(this,'ViewerBucket',{blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,encryption:s3.BucketEncryption.S3_MANAGED,enforceSSL:true,removalPolicy:cdk.RemovalPolicy.RETAIN});
    const videosTable=new dynamodb.Table(this,'VideosTable',{partitionKey:{name:'id',type:dynamodb.AttributeType.STRING},billingMode:dynamodb.BillingMode.PAY_PER_REQUEST,removalPolicy:cdk.RemovalPolicy.RETAIN});
    videosTable.addGlobalSecondaryIndex({indexName:'byUserId',partitionKey:{name:'userId',type:dynamodb.AttributeType.STRING},sortKey:{name:'createdAt',type:dynamodb.AttributeType.STRING}});
    // Preserve the original username-based pool. UsernameAttributes/AliasAttributes cannot be changed in place.
    const userPool=new cognito.UserPool(this,'UserPool',{userPoolName:'screenrec-users',selfSignUpEnabled:true,autoVerify:{email:true},standardAttributes:{email:{required:true,mutable:true}},passwordPolicy:{minLength:12,requireLowercase:true,requireUppercase:true,requireDigits:true},accountRecovery:cognito.AccountRecovery.EMAIL_ONLY,removalPolicy:cdk.RemovalPolicy.RETAIN});
    const callback=`https://${extensionId}.chromiumapp.org/`;
    const client=new cognito.UserPoolClient(this,'UserPoolClient',{userPool,generateSecret:false,enableTokenRevocation:true,oAuth:{flows:{authorizationCodeGrant:true},scopes:[cognito.OAuthScope.OPENID,cognito.OAuthScope.EMAIL,cognito.OAuthScope.PROFILE],callbackUrls:[callback],logoutUrls:[callback]},supportedIdentityProviders:[cognito.UserPoolClientIdentityProvider.COGNITO]});
    const domain=userPool.addDomain('HostedDomain',{cognitoDomain:{domainPrefix:`screenrec-${this.account}-${this.region}`}});
    const rewrite=new cloudfront.Function(this,'ViewerRoutes',{code:cloudfront.FunctionCode.fromInline("function handler(event) { var r = event.request; if (r.uri === '/' || /^\\/v\\/[a-f0-9-]+$/i.test(r.uri)) r.uri = '/index.html'; return r; }")});
    const distribution=new cloudfront.Distribution(this,'Distribution',{
      defaultRootObject:'index.html',defaultBehavior:{origin:origins.S3BucketOrigin.withOriginAccessControl(siteBucket),viewerProtocolPolicy:cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,cachePolicy:cloudfront.CachePolicy.CACHING_OPTIMIZED,functionAssociations:[{function:rewrite,eventType:cloudfront.FunctionEventType.VIEWER_REQUEST}]},
      additionalBehaviors:{'videos/*':{origin:origins.S3BucketOrigin.withOriginAccessControl(videoBucket),viewerProtocolPolicy:cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,cachePolicy:cloudfront.CachePolicy.CACHING_OPTIMIZED}},
      priceClass:cloudfront.PriceClass.PRICE_CLASS_100,
    });
    const viewerUrl=`https://${distribution.distributionDomainName}`;
    const api=new apigw.RestApi(this,'ScreenRecApi',{restApiName:'screenrec-api',defaultCorsPreflightOptions:{allowOrigins:['*'],allowMethods:['GET','POST','OPTIONS'],allowHeaders:['Content-Type','Authorization']},deployOptions:{stageName:'prod',throttlingBurstLimit:50,throttlingRateLimit:20}});
    const authorizer=new apigw.CognitoUserPoolsAuthorizer(this,'CognitoAuth',{cognitoUserPools:[userPool]});
    const auth:apigw.MethodOptions={authorizer,authorizationType:apigw.AuthorizationType.COGNITO};
    const aiBucket=new s3.Bucket(this,'AiArtifactsBucket',{
      blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,encryption:s3.BucketEncryption.S3_MANAGED,enforceSSL:true,
      removalPolicy:cdk.RemovalPolicy.RETAIN,lifecycleRules:[{prefix:'raw/',expiration:cdk.Duration.days(30)},{prefix:'frames/',expiration:cdk.Duration.days(30)}],
      cors:[{allowedOrigins:[`chrome-extension://${extensionId}`],allowedMethods:[s3.HttpMethods.PUT],allowedHeaders:['*'],maxAge:3600}],
    });
    const aiDeadLetters=new sqs.Queue(this,'AiDeadLetters',{
      retentionPeriod:cdk.Duration.days(14),encryption:sqs.QueueEncryption.SQS_MANAGED,
    });
    const jobPrefix='screenrec-';
    const modelId=String(this.node.tryGetContext('bedrockModelId') || 'us.amazon.nova-lite-v1:0');
    if(modelId.startsWith('arn:'))throw new Error('bedrockModelId must be a model ID or inference profile ID, not an ARN');
    const transcribeRole=new iam.Role(this,'TranscribeDataRole',{
      assumedBy:new iam.ServicePrincipal('transcribe.amazonaws.com',{conditions:{StringEquals:{'aws:SourceAccount':this.account}}}),
    });
    videoBucket.grantRead(transcribeRole,'videos/*');
    aiBucket.grantPut(transcribeRole,'raw/*');
    const transcriptionProvider=String(this.node.tryGetContext('transcriptionProvider') || 'groq');
    if (!['groq','transcribe'].includes(transcriptionProvider)) throw new Error('transcriptionProvider must be groq or transcribe');
    const groqParameter=String(this.node.tryGetContext('groqApiKeyParameter') || '/screenrec/groq-api-key');
    if (!/^\/[A-Za-z0-9_./-]+$/.test(groqParameter)) throw new Error('groqApiKeyParameter must be an absolute SSM parameter name');
    const aiEnvironment={TRANSCRIPTION_PROVIDER:transcriptionProvider,BUCKET_NAME:videoBucket.bucketName,AI_BUCKET_NAME:aiBucket.bucketName,TABLE_NAME:videosTable.tableName,JOB_PREFIX:jobPrefix};
    const aiResult=new lambda.Function(this,'AiResults',{
      runtime:lambda.Runtime.NODEJS_22_X,memorySize:512,timeout:cdk.Duration.seconds(180),
      handler:'ai.finishProcessing',code:lambda.Code.fromAsset(path.join(__dirname,'../dist/lambda')),
      environment:{...aiEnvironment,BEDROCK_MODEL_ID:modelId,GROQ_API_KEY_PARAMETER:groqParameter},
      deadLetterQueue:aiDeadLetters,retryAttempts:2,maxEventAge:cdk.Duration.hours(6),
    });
    const aiStart=new lambda.Function(this,'AiStart',{
      runtime:lambda.Runtime.NODEJS_22_X,memorySize:256,timeout:cdk.Duration.seconds(60),
      handler:'ai.startProcessing',code:lambda.Code.fromAsset(path.join(__dirname,'../dist/lambda')),
      environment:{...aiEnvironment,TRANSCRIBE_ROLE_ARN:transcribeRole.roleArn,RESULT_FUNCTION_ARN:aiResult.functionArn},
      deadLetterQueue:aiDeadLetters,retryAttempts:2,maxEventAge:cdk.Duration.hours(6),
    });
    videosTable.grantReadWriteData(aiStart);videosTable.grantReadWriteData(aiResult);
    videoBucket.grantRead(aiStart,'videos/*');
    aiBucket.grantPut(aiStart,'raw/*');aiBucket.grantRead(aiStart,'frames/*');
    aiBucket.grantRead(aiResult,'frames/*');aiBucket.grantRead(aiResult,'raw/*');aiBucket.grantReadWrite(aiResult,'processed/*');
    aiResult.grantInvoke(aiStart);
    videoBucket.grantRead(aiResult,'videos/*');
    aiResult.addToRolePolicy(new iam.PolicyStatement({actions:['ssm:GetParameter'],resources:[this.formatArn({service:'ssm',resource:'parameter',resourceName:groqParameter.slice(1),arnFormat:cdk.ArnFormat.SLASH_RESOURCE_NAME})]}));
    const jobArn=this.formatArn({service:'transcribe',resource:'transcription-job',resourceName:jobPrefix+'*',arnFormat:cdk.ArnFormat.SLASH_RESOURCE_NAME});
    aiStart.addToRolePolicy(new iam.PolicyStatement({actions:['transcribe:StartTranscriptionJob','transcribe:GetTranscriptionJob'],resources:[jobArn]}));
    aiResult.addToRolePolicy(new iam.PolicyStatement({actions:['transcribe:GetTranscriptionJob'],resources:[jobArn]}));
    aiStart.addToRolePolicy(new iam.PolicyStatement({actions:['iam:PassRole'],resources:[transcribeRole.roleArn],conditions:{StringEquals:{'iam:PassedToService':'transcribe.amazonaws.com'}}}));
    // Cross-region inference requires both the profile and its backing foundation model.
    const modelBase=modelId.replace(/^(us|eu|apac|global)\./,'');
    const modelResources=[
      this.formatArn({service:'bedrock',resource:'inference-profile',resourceName:modelId,arnFormat:cdk.ArnFormat.SLASH_RESOURCE_NAME}),
      `arn:${this.partition}:bedrock:*::foundation-model/${modelBase}`,
    ];
    aiResult.addToRolePolicy(new iam.PolicyStatement({actions:['bedrock:InvokeModel'],resources:modelResources}));
    // One-time, explicit model activation. Default invokers do not subscribe to products.
    if (String(this.node.tryGetContext('allowModelSubscription')).toLowerCase() === 'true') {
      const productId = this.node.tryGetContext('marketplaceProductId') ||
        (modelBase === 'anthropic.claude-haiku-4-5-20251001-v1:0' ? 'prod-xdkflymybwmvi' : undefined);
      if (!productId || !/^prod-[a-z0-9]+$/.test(String(productId))) throw new Error('Set marketplaceProductId to the exact Bedrock model product ID before allowing subscription.');
      aiResult.addToRolePolicy(new iam.PolicyStatement({actions:['aws-marketplace:ViewSubscriptions'],resources:['*']}));
      aiResult.addToRolePolicy(new iam.PolicyStatement({
        actions:['aws-marketplace:Subscribe'],resources:['*'],
        conditions:{StringEquals:{'aws-marketplace:ProductId':String(productId)}},
      }));
    }

    new events.Rule(this,'TranscriptionFinished',{
      eventPattern:{source:['aws.transcribe'],detailType:['Transcribe Job State Change'],detail:{
        TranscriptionJobName:[{prefix:jobPrefix}],TranscriptionJobStatus:['COMPLETED','FAILED'],
      }},
      targets:[new targets.LambdaFunction(aiResult,{deadLetterQueue:aiDeadLetters,retryAttempts:2})],
    });
    videoBucket.addEventNotification(s3.EventType.OBJECT_CREATED_COMPLETE_MULTIPART_UPLOAD,new s3n.LambdaDestination(aiStart),{prefix:'videos/',suffix:'/recording.webm'});
    const functions:Record<string,lambda.Function>={};
    for(const name of ['createVideo','getPartUrl','completeUpload','cancelUpload','getVideo','listVideos','getTranscript','retryAi','getFrameUrl']) {
      const fn=new lambda.Function(this,name,{runtime:lambda.Runtime.NODEJS_22_X,memorySize:256,timeout:cdk.Duration.seconds(30),handler:`videos.${name}`,code:lambda.Code.fromAsset(path.join(__dirname,'../dist/lambda')),environment:{BUCKET_NAME:videoBucket.bucketName,TABLE_NAME:videosTable.tableName,CLOUDFRONT_URL:viewerUrl,VIEWER_URL:viewerUrl,...(['getTranscript','getFrameUrl'].includes(name)?{AI_BUCKET_NAME:aiBucket.bucketName}:{}),...(name==='retryAi'?{AI_START_FUNCTION_ARN:aiStart.functionArn}:{})}});
      if(['getVideo','listVideos','getPartUrl','getTranscript','getFrameUrl'].includes(name)) videosTable.grantReadData(fn); else videosTable.grantReadWriteData(fn);
      if(name==='createVideo') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({actions:['s3:PutObject','s3:AbortMultipartUpload'],resources:[videoBucket.arnForObjects('videos/*')]}));
      if(name==='getPartUrl') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({actions:['s3:PutObject'],resources:[videoBucket.arnForObjects('videos/*')]}));
      if(name==='completeUpload') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({actions:['s3:PutObject','s3:GetObject','s3:ListMultipartUploadParts'],resources:[videoBucket.arnForObjects('videos/*')]}));
      if(name==='cancelUpload') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({actions:['s3:AbortMultipartUpload'],resources:[videoBucket.arnForObjects('videos/*')]}));
      if(name==='getTranscript')aiBucket.grantRead(fn,'processed/*');
      if(name==='retryAi')aiStart.grantInvoke(fn);
      if(name==='getFrameUrl')aiBucket.grantPut(fn,'frames/*');
      functions[name]=fn;
    }
    const videos=api.root.addResource('videos'); videos.addMethod('POST',new apigw.LambdaIntegration(functions.createVideo),auth); videos.addMethod('GET',new apigw.LambdaIntegration(functions.listVideos),auth);
    const video=videos.addResource('{id}'); video.addMethod('GET',new apigw.LambdaIntegration(functions.getVideo),{authorizationType:apigw.AuthorizationType.NONE});
    video.addResource('transcript').addMethod('GET',new apigw.LambdaIntegration(functions.getTranscript),{authorizationType:apigw.AuthorizationType.NONE});
    video.addResource('frames').addMethod('POST',new apigw.LambdaIntegration(functions.getFrameUrl),auth);
    video.addResource('ai').addMethod('POST',new apigw.LambdaIntegration(functions.retryAi),auth);
    for(const [route,handler] of [['parts','getPartUrl'],['complete','completeUpload'],['cancel','cancelUpload']]) video.addResource(route).addMethod('POST',new apigw.LambdaIntegration(functions[handler]),auth);
    for(const type of [apigw.ResponseType.DEFAULT_4XX,apigw.ResponseType.DEFAULT_5XX]) api.addGatewayResponse(type.responseType,{type,responseHeaders:{'Access-Control-Allow-Origin':"'*'",'Access-Control-Allow-Headers':"'Content-Type,Authorization'"}});
    const outputs={ApiUrl:api.url,CloudFrontUrl:viewerUrl,ViewerUrl:viewerUrl,UserPoolId:userPool.userPoolId,UserPoolClientId:client.userPoolClientId,CognitoDomain:domain.baseUrl(),BucketName:videoBucket.bucketName,ViewerBucketName:siteBucket.bucketName,DistributionId:distribution.distributionId,AiArtifactsBucketName:aiBucket.bucketName,AiDeadLetterQueueUrl:aiDeadLetters.queueUrl,BedrockModelId:modelId,TranscriptionProvider:transcriptionProvider,GroqApiKeyParameter:groqParameter};
    for(const [name,value] of Object.entries(outputs)) new cdk.CfnOutput(this,name,{value});
  }
}
