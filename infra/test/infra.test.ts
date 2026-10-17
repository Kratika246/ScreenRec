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
  template.resourceCountIs('AWS::S3::Bucket',2);
  template.resourceCountIs('AWS::CloudFront::OriginAccessControl',2);
  template.hasResourceProperties('AWS::S3::Bucket',{PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true},LifecycleConfiguration:{Rules:Match.arrayWith([Match.objectLike({AbortIncompleteMultipartUpload:{DaysAfterInitiation:1}})])}});
  template.hasResourceProperties('AWS::ApiGateway::Method',{HttpMethod:'GET',AuthorizationType:'NONE'});
  template.hasResourceProperties('AWS::ApiGateway::Method',{HttpMethod:'POST',AuthorizationType:'COGNITO_USER_POOLS'});
  template.hasResourceProperties('AWS::Cognito::UserPoolClient',{GenerateSecret:false,AllowedOAuthFlows:['code'],EnableTokenRevocation:true});
  template.hasResourceProperties('AWS::Lambda::Function',{Runtime:'nodejs22.x',Handler:'videos.completeUpload',Environment:{Variables:Match.objectLike({VIEWER_URL:Match.anyValue(),CLOUDFRONT_URL:Match.anyValue()})}});
});
