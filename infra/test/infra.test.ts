import * as cdk from 'aws-cdk-lib';
import {Template,Match} from 'aws-cdk-lib/assertions';
import {InfraStack} from '../lib/infra-stack';
test('private origins, multipart cleanup, Cognito writes and public shared reads',()=>{
  const app=new cdk.App(), stack=new InfraStack(app,'Test',{env:{account:'123456789012',region:'us-east-1'}});
  const template=Template.fromStack(stack);
  const pools=template.findResources('AWS::Cognito::UserPool');
  expect(Object.keys(pools)).toEqual(['UserPool6BA7E5F2']);
  expect(pools.UserPool6BA7E5F2.Properties.UsernameAttributes).toBeUndefined();
  expect(pools.UserPool6BA7E5F2.Properties.AliasAttributes).toBeUndefined();
  template.resourceCountIs('AWS::S3::Bucket',3);
  template.resourceCountIs('AWS::CloudFront::OriginAccessControl',2);
  template.hasResourceProperties('AWS::Events::Rule',{EventPattern:{source:['aws.transcribe'],'detail-type':['Transcribe Job State Change'],detail:{TranscriptionJobName:[{prefix:'screenrec-'}],TranscriptionJobStatus:['COMPLETED','FAILED']}}});
  template.hasResourceProperties('AWS::Lambda::Function',{Handler:'ai.startProcessing',Environment:{Variables:Match.objectLike({AI_BUCKET_NAME:Match.anyValue(),TRANSCRIBE_ROLE_ARN:Match.anyValue()})}});
  template.hasResourceProperties('AWS::Lambda::Function',{Handler:'ai.finishProcessing',Environment:{Variables:Match.objectLike({BEDROCK_MODEL_ID:'us.amazon.nova-lite-v1:0',TRANSCRIPTION_PROVIDER:'groq',GROQ_API_KEY_PARAMETER:'/screenrec/groq-api-key'})}});
  template.hasResourceProperties('Custom::S3BucketNotifications',{NotificationConfiguration:{LambdaFunctionConfigurations:Match.arrayWith([Match.objectLike({Events:['s3:ObjectCreated:CompleteMultipartUpload']})])}});
  template.hasResourceProperties('AWS::SQS::Queue',{MessageRetentionPeriod:1209600});
  template.hasResourceProperties('AWS::S3::Bucket',{PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true},LifecycleConfiguration:{Rules:Match.arrayWith([Match.objectLike({AbortIncompleteMultipartUpload:{DaysAfterInitiation:1}})])}});
  template.hasResourceProperties('AWS::ApiGateway::Method',{HttpMethod:'GET',AuthorizationType:'NONE'});
  template.hasResourceProperties('AWS::ApiGateway::Method',{HttpMethod:'POST',AuthorizationType:'COGNITO_USER_POOLS'});
  template.hasResourceProperties('AWS::Cognito::UserPoolClient',{GenerateSecret:false,AllowedOAuthFlows:['code'],EnableTokenRevocation:true});
  template.hasResourceProperties('AWS::Lambda::Function',{Runtime:'nodejs22.x',Handler:'videos.completeUpload',Environment:{Variables:Match.objectLike({VIEWER_URL:Match.anyValue(),CLOUDFRONT_URL:Match.anyValue()})}});
});

test('one-time model activation can subscribe only to the configured Haiku product',()=>{
  const app=new cdk.App({context:{allowModelSubscription:'true',bedrockModelId:'us.anthropic.claude-haiku-4-5-20251001-v1:0'}});
  const template=Template.fromStack(new InfraStack(app,'Activation',{env:{account:'123456789012',region:'us-east-1'}}));
  const policies=Object.values(template.findResources('AWS::IAM::Policy')) as {Properties:{PolicyDocument:{Statement:{Action:string|string[];Resource:unknown;Condition?:unknown}[]}}}[];
  const statements=policies.flatMap(policy=>policy.Properties.PolicyDocument.Statement);
  const actions=(statement:{Action:string|string[]})=>Array.isArray(statement.Action)?statement.Action:[statement.Action];
  const subscribe=statements.filter(statement=>actions(statement).includes('aws-marketplace:Subscribe'));
  expect(subscribe).toHaveLength(1);
  expect(subscribe[0].Condition).toEqual({StringEquals:{'aws-marketplace:ProductId':'prod-xdkflymybwmvi'}});
  expect(statements.some(statement=>actions(statement).includes('aws-marketplace:ViewSubscriptions'))).toBe(true);
  expect(statements.some(statement=>actions(statement).includes('aws-marketplace:*'))).toBe(false);
});

test('default Nova vision model needs no Marketplace subscription permissions',()=>{
  const template=Template.fromStack(new InfraStack(new cdk.App(),'Nova',{env:{account:'123456789012',region:'us-east-1'}})).toJSON();
  const serialized=JSON.stringify(template);
  expect(serialized).toContain('us.amazon.nova-lite-v1:0');
  expect(serialized).toContain('foundation-model/amazon.nova-lite-v1:0');
  expect(serialized).not.toContain('aws-marketplace:Subscribe');
  expect(serialized).not.toContain('aws-marketplace:Unsubscribe');
});
