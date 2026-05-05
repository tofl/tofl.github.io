---
title: "SAM Transform Under the Hood: How SAM Templates Are Converted to CloudFormation"
---

## SAM Transform Under the Hood: How SAM Templates Are Converted to CloudFormation

When you deploy a serverless application using the AWS Serverless Application Model (SAM), something magical seems to happen. You write a few lines of YAML defining a function and an API, and suddenly a complete, production-ready infrastructure emerges with Lambda functions, IAM roles, API Gateway resources, and CloudWatch log groups all wired together. But there's nothing magical about it—just a clever transformation layer that translates your compact SAM syntax into explicit CloudFormation templates.

Understanding how this transformation works isn't just academically interesting; it's genuinely practical. When you need to troubleshoot why permissions aren't working, understand what resources are actually being created, or optimize your infrastructure, you need to see past the SAM abstraction and understand the CloudFormation reality underneath. This article walks you through exactly that: how SAM's transform mechanism works, what it generates, and how to inspect the results.

### What Is the SAM Transform?

The SAM transform is a CloudFormation macro—specifically, the `AWS::Serverless-2016-10-31` transform—that preprocesses your template before CloudFormation sees it. When you include this transform at the top of your template, CloudFormation sends your template to the SAM transform service, which reads your shorthand serverless resource definitions and expands them into the full CloudFormation resources they represent.

Think of it like a template preprocessor. You write elegant, concise serverless syntax, and the transform converts it into verbose, explicit CloudFormation. The resulting template is valid CloudFormation that CloudFormation then processes normally to create your actual AWS resources.

This is why a SAM template file is still fundamentally a CloudFormation template—it just uses a special transform that tells CloudFormation how to interpret additional resource types that CloudFormation doesn't natively understand.

### The Mechanics: How Transformation Works

When you run `sam deploy` or `sam build`, several things happen in sequence. First, the SAM CLI invokes the CloudFormation service with your template and the `AWS::Serverless-2016-10-31` transform declaration. CloudFormation recognizes this transform and sends your template to the SAM transform service (a Lambda function running behind the scenes in your AWS account region).

The SAM transform service parses your template, identifies serverless resource types like `AWS::Serverless::Function` and `AWS::Serverless::Api`, and replaces each one with the corresponding CloudFormation resources. For example, a single `AWS::Serverless::Function` might expand into an `AWS::Lambda::Function`, one or more `AWS::IAM::Role` resources, and potentially `AWS::Lambda::Permission` resources if the function is triggered by an API Gateway.

After transformation, the result is a complete CloudFormation template containing only native CloudFormation resource types. This transformed template is what actually gets deployed. CloudFormation then processes it as it normally would, creating the AWS resources specified within.

This two-stage process—transformation then deployment—explains why understanding the generated template is so valuable. The resources CloudFormation creates, the permissions it grants, and the connections it establishes all flow from what the transform generates.

### A Concrete Example: From SAM to CloudFormation

Let's make this concrete. Here's a simple SAM template that defines a Lambda function and an API Gateway to invoke it:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: Simple serverless API

Globals:
  Function:
    Timeout: 30
    MemorySize: 256
    Runtime: python3.11

Resources:
  GetUserFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/handlers/get_user.handler
      CodeUri: src/
      Events:
        GetUserRequest:
          Type: Api
          Properties:
            RestApiId: !Ref UserApi
            Path: /users/{id}
            Method: GET

  UserApi:
    Type: AWS::Serverless::Api
    Properties:
      StageName: prod
      TracingEnabled: true
```

This is clean, readable, and expresses your intent clearly: you want a Lambda function with a GET endpoint that returns user data. But CloudFormation doesn't understand `AWS::Serverless::Function` or `AWS::Serverless::Api`. The transform converts this into something that does.

After the SAM transform processes this template, the generated CloudFormation template includes the following (simplified for clarity):

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: Simple serverless API

Resources:
  GetUserFunctionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

  GetUserFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: GetUserFunction
      Runtime: python3.11
      Handler: src/handlers/get_user.handler
      Code:
        S3Bucket: aws-sam-cli-managed-default-samclisourcebucket-xxxxx
        S3Key: xxxxxxxxxxxxx
      Role: !GetAtt GetUserFunctionRole.Arn
      Timeout: 30
      MemorySize: 256

  UserApi:
    Type: AWS::ApiGateway::RestApi
    Properties:
      Name: UserApi
      TracingEnabled: true

  UserApiProdStage:
    Type: AWS::ApiGateway::Stage
    Properties:
      RestApiId: !Ref UserApi
      StageName: prod
      DeploymentId: !Ref UserApiDeployment

  UserApiDeployment:
    Type: AWS::ApiGateway::Deployment
    DependsOn:
      - GetUserRequestMethod
    Properties:
      RestApiId: !Ref UserApi

  GetUserResource:
    Type: AWS::ApiGateway::Resource
    Properties:
      RestApiId: !Ref UserApi
      ParentId: !GetAtt UserApi.RootResourceId
      PathPart: users

  GetUserIdResource:
    Type: AWS::ApiGateway::Resource
    Properties:
      RestApiId: !Ref UserApi
      ParentId: !Ref GetUserResource
      PathPart: '{id}'

  GetUserRequestMethod:
    Type: AWS::ApiGateway::Method
    Properties:
      RestApiId: !Ref UserApi
      ResourceId: !Ref GetUserIdResource
      HttpMethod: GET
      AuthorizationType: NONE
      Integration:
        Type: aws_proxy
        IntegrationHttpMethod: POST
        Uri: !Sub 'arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${GetUserFunction.Arn}/invocations'

  GetUserFunctionApiPermission:
    Type: AWS::Lambda::Permission
    Properties:
      FunctionName: !Ref GetUserFunction
      Action: lambda:InvokeFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub 'arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${UserApi}/*/*'
```

Notice what happened here. Your two SAM resource types expanded into ten CloudFormation resources. The single `AWS::Serverless::Function` became:

- An `AWS::IAM::Role` with the appropriate assume role policy for Lambda
- The actual `AWS::Lambda::Function` resource with your code location and configuration
- An `AWS::Lambda::Permission` that allows API Gateway to invoke the function

The `AWS::Serverless::Api` became:

- An `AWS::ApiGateway::RestApi`
- An `AWS::ApiGateway::Deployment` (needed to make changes live)
- An `AWS::ApiGateway::Stage` representing the `prod` environment
- `AWS::ApiGateway::Resource` objects for the path segments (`/users` and `/{id}`)
- An `AWS::ApiGateway::Method` that binds the GET verb to the resource and connects it to your Lambda function via an integration

All the wiring—the permissions, the IAM role, the nested resource structure—is handled by the transform. This is why SAM is so powerful: it abstracts away the boilerplate that CloudFormation requires while letting you focus on your business logic.

### Inspecting the Generated Template

Understanding what the transform generates is useful, but seeing it for your own template is even better. SAM provides several ways to inspect the transformed output.

The simplest method is to use `sam build` with the `--debug` flag, which outputs the transformed template to your terminal:

```bash
sam build --debug
```

You'll see CloudFormation JSON or YAML reflecting what the transform produced. It's verbose but illuminating.

Another approach is to use `sam build` and then look in the `.aws-sam/build/template.yaml` file in your project directory. This contains the processed template after SAM's local transformations but before CloudFormation processes it. This intermediate template can be helpful for understanding what's happening before the full CloudFormation expansion.

For an even more detailed view, you can examine the actual CloudFormation template in the AWS CloudFormation console after deployment. Navigate to your stack, switch to the "Template" tab, and click "View in Designer" or simply view the template source. This shows you the complete, transformed template that CloudFormation is managing.

If you want to see the transformation without deploying, you can also use the AWS CloudFormation API directly by submitting your template with the transform directive to the `ValidateTemplate` operation, though this is less common in practice.

### What Else Does SAM Transform Do?

Beyond expanding resource types, the SAM transform handles several other transformations:

**Implicit API Creation**: When you define events on a function without specifying a RestApiId, SAM automatically creates an implicit API Gateway resource and wires everything together. This is convenient but can be surprising if you're not aware of it—you suddenly have an API Gateway in your account without explicitly defining one.

**Environment Variables and Secrets**: SAM can inject environment variables from Parameters or external sources into your functions during transformation. The transform ensures these make it into the CloudFormation Lambda function definition.

**Function Layers**: SAM's `Layers` property on functions is transformed into `AWS::Lambda::LayerVersion` resources and the appropriate references in your function definition.

**Policies**: SAM's `Policies` property on functions is expanded into inline or attached IAM policies on the generated role. This is exceptionally useful because it lets you define least-privilege permissions inline with your function, rather than managing separate IAM policy documents.

**Globals**: The `Globals` section allows you to define properties that apply to all resources of a given type, reducing repetition. The transform merges these global properties into each resource during expansion.

### Understanding IAM Role Generation

One of the most important transformations involves IAM roles. When you define a `AWS::Serverless::Function`, SAM automatically generates an `AWS::IAM::Role` with an appropriate assume role policy for Lambda.

If you don't explicitly define a `Role` property on your function, SAM creates one. If you do specify a role ARN, SAM uses that instead. This flexibility is valuable because it lets you either use SAM's automatic role management for simple cases or bring your own roles for more complex scenarios.

The generated role includes the AWS managed policy `AWSLambdaBasicExecutionRole` by default, which grants permissions for CloudWatch Logs. If you need additional permissions—to read from DynamoDB, write to S3, or anything else—you specify them using SAM's `Policies` property, and the transform adds them to your function's role.

Here's an example:

```yaml
GetUserFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: index.handler
    Runtime: python3.11
    Policies:
      - DynamoDBReadPolicy:
          TableName: !Ref UsersTable
      - S3CrudPolicy:
          BucketName: !Ref UserPhotosBucket
```

The transform expands the policy shortcuts (`DynamoDBReadPolicy`, `S3CrudPolicy`) into actual IAM policy statements and attaches them to the generated role. This is far more concise than writing raw IAM policy JSON while remaining explicit about what permissions are granted.

### Event Sources and Implicit Resource Creation

SAM's `Events` property on functions is another powerful transformation mechanism. You specify what should trigger your function—an API Gateway request, an SNS topic, a CloudWatch scheduled event—and SAM creates the necessary resources and permissions.

For example, specifying an `Api` event with a path and method causes SAM to create API Gateway resources (or reuse existing ones if you reference an explicit API), create a method, set up the Lambda integration, and create the permission allowing API Gateway to invoke your function.

```yaml
Events:
  ListUsers:
    Type: Api
    Properties:
      Path: /users
      Method: get
```

This event definition transforms into multiple CloudFormation resources that together enable API Gateway to invoke your function. The transform handles all the plumbing.

Similarly, defining an `S3` event creates an `AWS::Lambda::Permission` allowing S3 to invoke your function and adds the bucket notification configuration. A `Schedule` event creates a CloudWatch Events rule. Each event type knows how to wire itself to the appropriate AWS service.

### Working with Metadata and Transform Intrinsics

SAM also respects CloudFormation's metadata and intrinsic functions. You can use `!Ref`, `!GetAtt`, `!Sub`, and all the standard CloudFormation functions in your SAM template, and they work as expected in the transformed template.

This is important because it means your SAM template isn't limited to SAM-specific features. You can mix and match, using CloudFormation constructs where SAM doesn't provide a shorthand.

You can also include native CloudFormation resources alongside your SAM resources. If you need a DynamoDB table, SQS queue, or any other AWS resource, just define it using standard CloudFormation syntax in the same template. The transform leaves these alone and passes them through to CloudFormation unchanged.

### Debugging Transformation Issues

When something doesn't work as expected—permissions are missing, resources aren't created, or integrations don't connect—examining the transformed template is your first diagnostic step.

If a Lambda function can't invoke DynamoDB, look at the generated IAM role policy to confirm the DynamoDB permission is present. If an API isn't routing requests correctly, inspect the API Gateway resources and methods to verify the structure matches your expectations. If S3 bucket notifications aren't triggering your function, check that the Lambda permission exists and grants S3 the right to invoke.

Using `sam build --debug` or viewing the transformed template in CloudFormation gives you this visibility. You're no longer working with an abstraction; you're seeing the actual resources that will be created.

Sometimes the issue is subtle. Perhaps you forgot that SAM creates an implicit API when you don't specify a RestApiId, and you end up with two APIs. Or maybe you specified a policy that doesn't grant quite the right permissions, and the transform correctly created it but it's still not what you need. Seeing the transformed template makes these issues obvious.

### Performance and Cost Implications of Transformation

One concern developers sometimes have is whether the transformation adds overhead or costs. The answer is no—the transformation happens once at deployment time and doesn't affect runtime performance or incur charges. The transformed template is what actually gets deployed, and CloudFormation creates the resources specified in it. There's no transform layer sitting between your code and AWS at runtime.

The only performance consideration is deployment time. Because SAM templates are more concise, they often build and deploy slightly faster than equivalent CloudFormation templates written entirely by hand. The transformation itself is quick.

Cost-wise, all resources created are standard AWS resources. A Lambda function created via SAM costs exactly the same as one created via CloudFormation or the console. You're not paying for the transformation; you're paying for the resources.

### SAM Templates with Multiple Transforms

Technically, CloudFormation allows multiple transforms. You could combine SAM with another macro if needed. However, this is rare and generally not recommended because it complicates the template and makes it harder to understand what's happening. Stick with SAM for serverless and use regular CloudFormation resources alongside it when you need non-serverless infrastructure.

### Conclusion

The SAM transform is an elegant solution to a real problem: CloudFormation, while powerful, requires significant boilerplate for serverless applications. By transforming your concise serverless definitions into verbose CloudFormation templates, SAM gives you the best of both worlds—clean, readable infrastructure code combined with CloudFormation's full power and visibility.

Understanding this transformation mechanism equips you to write better SAM templates, troubleshoot more effectively when things don't work, and appreciate what's actually being created in your AWS account. The next time you deploy a SAM template, take a moment to inspect the generated CloudFormation. You'll gain insights that make you a better serverless developer, and you'll develop an intuition for how your infrastructure actually works behind the scenes.
