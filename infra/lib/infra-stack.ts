import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
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
    const functions:Record<string,lambda.Function>={};
    for(const name of ['createVideo','getPartUrl','completeUpload','cancelUpload','getVideo','listVideos']) {
      const fn=new lambda.Function(this,name,{runtime:lambda.Runtime.NODEJS_22_X,memorySize:256,timeout:cdk.Duration.seconds(30),handler:`videos.${name}`,code:lambda.Code.fromAsset(path.join(__dirname,'../dist/lambda')),environment:{BUCKET_NAME:videoBucket.bucketName,TABLE_NAME:videosTable.tableName,CLOUDFRONT_URL:viewerUrl,VIEWER_URL:viewerUrl}});
      if(['getVideo','listVideos','getPartUrl'].includes(name)) videosTable.grantReadData(fn); else videosTable.grantReadWriteData(fn);
      if(name==='createVideo') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({actions:['s3:PutObject','s3:AbortMultipartUpload'],resources:[videoBucket.arnForObjects('videos/*')]}));
      if(name==='getPartUrl') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({actions:['s3:PutObject'],resources:[videoBucket.arnForObjects('videos/*')]}));
      if(name==='completeUpload') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({actions:['s3:PutObject','s3:GetObject','s3:ListMultipartUploadParts'],resources:[videoBucket.arnForObjects('videos/*')]}));
      if(name==='cancelUpload') fn.addToRolePolicy(new cdk.aws_iam.PolicyStatement({actions:['s3:AbortMultipartUpload'],resources:[videoBucket.arnForObjects('videos/*')]}));
      functions[name]=fn;
    }
    const videos=api.root.addResource('videos'); videos.addMethod('POST',new apigw.LambdaIntegration(functions.createVideo),auth); videos.addMethod('GET',new apigw.LambdaIntegration(functions.listVideos),auth);
    const video=videos.addResource('{id}'); video.addMethod('GET',new apigw.LambdaIntegration(functions.getVideo),{authorizationType:apigw.AuthorizationType.NONE});
    for(const [route,handler] of [['parts','getPartUrl'],['complete','completeUpload'],['cancel','cancelUpload']]) video.addResource(route).addMethod('POST',new apigw.LambdaIntegration(functions[handler]),auth);
    for(const type of [apigw.ResponseType.DEFAULT_4XX,apigw.ResponseType.DEFAULT_5XX]) api.addGatewayResponse(type.responseType,{type,responseHeaders:{'Access-Control-Allow-Origin':"'*'",'Access-Control-Allow-Headers':"'Content-Type,Authorization'"}});
    const outputs={ApiUrl:api.url,CloudFrontUrl:viewerUrl,ViewerUrl:viewerUrl,UserPoolId:userPool.userPoolId,UserPoolClientId:client.userPoolClientId,CognitoDomain:domain.baseUrl(),BucketName:videoBucket.bucketName,ViewerBucketName:siteBucket.bucketName,DistributionId:distribution.distributionId};
    for(const [name,value] of Object.entries(outputs)) new cdk.CfnOutput(this,name,{value});
  }
}
