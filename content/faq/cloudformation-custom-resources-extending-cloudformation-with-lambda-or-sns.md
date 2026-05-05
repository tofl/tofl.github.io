---
title: "CloudFormation Custom Resources: Extending CloudFormation with Lambda or SNS"
---

## CloudFormation Custom Resources: Extending CloudFormation with Lambda or SNS

CloudFormation is powerful for infrastructure as code, but it has a fundamental limitation: it only knows how to manage AWS resources natively. What happens when you need to integrate with a third-party API, validate prerequisites before deployment, or manage a resource type that CloudFormation doesn't support? This is where custom resources come in. They're a bridge that lets you extend CloudFormation's capabilities by tapping into Lambda functions or SNS topics to handle operations CloudFormation can't do on its own.

Custom resources transform CloudFormation from a tool that manages only AWS services into a flexible orchestration platform capable of coordinating your entire infrastructure ecosystem. Whether you're provisioning a third-party SaaS account, running validation logic, or implementing complex resource dependencies, custom resources give you the power to do it all within your CloudFormation template.

### Understanding Custom Resources and When to Use Them

A custom resource is essentially a CloudFormation resource type that you define yourself. Instead of CloudFormation having built-in knowledge about how to create, update, or delete it, you provide the logic through a Lambda function or SNS topic. When CloudFormation encounters a custom resource in your template, it doesn't attempt to manage it directly—instead, it invokes your handler and waits for a response telling it whether the operation succeeded.

Think of it this way: CloudFormation acts like a contractor who knows how to build some things (EC2 instances, S3 buckets, IAM roles) but needs to hire a specialist for custom work. When the contractor encounters custom work, they call the specialist, provide detailed instructions about what's needed, and wait for confirmation that it's done.

You'd reach for custom resources when you need to create resources that CloudFormation doesn't natively support. This includes third-party services like Datadog monitoring setup, external APIs for account provisioning, or even custom validation logic. Custom resources also shine when you need to perform cleanup operations beyond what CloudFormation typically handles, or when you need to generate dynamic values based on external systems.

### The Service Token: How CloudFormation Knows Where to Call

Every custom resource requires a `ServiceToken` property, which tells CloudFormation where to send the request. This token is either a Lambda function ARN or an SNS topic ARN. CloudFormation will invoke this endpoint whenever it needs to perform an operation on your custom resource.

For Lambda-backed custom resources, the ServiceToken looks like this:

```
arn:aws:lambda:us-east-1:123456789012:function:my-custom-resource-handler
```

For SNS-backed custom resources, it looks similar but points to an SNS topic:

```
arn:aws:sns:us-east-1:123456789012:my-custom-resource-topic
```

Lambda is typically the preferred choice because it's more straightforward—CloudFormation invokes it directly and receives the response synchronously. SNS can be useful in scenarios where you want to decouple the request from processing, or when you need multiple subscribers to handle requests, though this adds complexity around response handling.

In your CloudFormation template, a basic custom resource definition looks like this:

```yaml
Resources:
  MyCustomResource:
    Type: AWS::CloudFormation::CustomResource
    Properties:
      ServiceToken: !GetAtt CustomResourceLambda.Arn
      SomeProperty: SomeValue
      AnotherProperty: AnotherValue
```

Any properties you define on the custom resource (beyond the standard CloudFormation properties) get passed to your handler function as part of the request payload. This allows you to parameterize your custom resource behavior.

### The Request/Response Envelope: What CloudFormation Sends and Expects

When CloudFormation triggers your custom resource handler, it sends a carefully structured JSON payload containing all the information your handler needs to perform the operation. Understanding this envelope is critical for writing reliable handlers.

The request payload CloudFormation sends includes several key fields. The `RequestType` indicates whether this is a `Create`, `Update`, or `Delete` operation. The `ResponseURL` is a special presigned S3 URL where you must send your response back to CloudFormation—this is how your handler communicates success or failure. The `StackId` identifies which stack is making the request, and `RequestId` uniquely identifies this particular request, which you'll include in your response.

The `LogicalResourceId` is the name of the custom resource as defined in your template, and `PhysicalResourceId` is an identifier you assign (more on this shortly). The `ResourceProperties` object contains all the properties you defined on the custom resource in your template, allowing you to pass configuration to your handler.

Here's what a typical request payload looks like:

```json
{
  "RequestType": "Create",
  "ResponseURL": "https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/...",
  "StackId": "arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/12345678",
  "RequestId": "12345678-1234-1234-1234-123456789012",
  "ResourceType": "AWS::CloudFormation::CustomResource",
  "LogicalResourceId": "MyCustomResource",
  "PhysicalResourceId": "physical-resource-id",
  "ResourceProperties": {
    "ServiceToken": "arn:aws:lambda:us-east-1:123456789012:function:my-handler",
    "SomeProperty": "SomeValue",
    "AnotherProperty": "AnotherValue"
  }
}
```

Your handler must respond with a success or failure response. The response must be sent as an HTTP PUT request to the ResponseURL provided in the request. A successful response looks like this:

```json
{
  "Status": "SUCCESS",
  "PhysicalResourceId": "my-unique-resource-id",
  "StackId": "arn:aws:cloudformation:us-east-1:123456789012:stack/my-stack/12345678",
  "RequestId": "12345678-1234-1234-1234-123456789012",
  "LogicalResourceId": "MyCustomResource",
  "Data": {
    "OutputKey1": "OutputValue1",
    "OutputKey2": "OutputValue2"
  }
}
```

A failure response uses the same structure but with `Status` set to `FAILED` and includes a `Reason` field explaining what went wrong.

### Managing PhysicalResourceId for Idempotency

The `PhysicalResourceId` deserves special attention because it's critical for understanding CloudFormation's behavior across create, update, and delete operations. This is a unique identifier that represents the actual resource your handler creates or manages. CloudFormation uses it to track the resource across the resource's lifetime.

When you create a custom resource, your handler is responsible for generating and returning a `PhysicalResourceId`. This identifier should uniquely represent the actual resource you've created or managed. For example, if you're provisioning a third-party service account, the `PhysicalResourceId` might be the external service's account ID. If you're managing a Datadog integration, it might be the integration ID returned by Datadog's API.

The `PhysicalResourceId` is particularly important during updates. When CloudFormation detects changes to a custom resource's properties and triggers an update, it passes the existing `PhysicalResourceId` to your handler in the request. If you return the same `PhysicalResourceId`, CloudFormation interprets this as an in-place update. If you return a different `PhysicalResourceId`, CloudFormation will create a new resource and delete the old one—this is called a replacement update.

This behavior enables idempotency. If your Lambda function is invoked multiple times for the same operation (due to network retries or other issues), returning the same `PhysicalResourceId` ensures CloudFormation doesn't think you've created a new resource.

Consider this scenario: you're managing an external API resource. When creating it, the API returns an ID. You should store this ID and use it as your `PhysicalResourceId`. On subsequent updates, you check if the resource still exists using that ID, modify it if needed, and return the same ID. If CloudFormation retries due to network issues, your handler sees the same ID and updates the existing resource rather than creating a duplicate.

### Handling Create, Update, and Delete Operations

Your custom resource handler needs to respond appropriately to three distinct operation types, each with different semantics and responsibilities.

For a `Create` operation, CloudFormation is asking you to create a new instance of your custom resource. You receive the `ResourceProperties` containing all the configuration from the template, and you should use those properties to create whatever external resource you're managing. Once created, you return a `PhysicalResourceId` that identifies the created resource, along with any output data via the `Data` object.

An `Update` operation occurs when CloudFormation detects that the properties of an existing custom resource have changed. You receive both the old `PhysicalResourceId` and the updated `ResourceProperties`. Now you need to decide: can you modify the existing resource to match the new properties, or do you need to create a new resource and delete the old one? If you can modify it, return the same `PhysicalResourceId`. If you need replacement, generate a new `PhysicalResourceId`, create the new resource, and let CloudFormation handle deletion of the old one (via a subsequent Delete operation).

A `Delete` operation tells you that the CloudFormation stack containing this custom resource is being deleted. You should clean up any resources you created—terminate external accounts, delete API integrations, remove data, etc. The delete operation receives the `PhysicalResourceId` so you can identify exactly which resource to clean up.

### Building a Lambda-Backed Custom Resource: A Practical Example

Let's build a concrete example: a custom resource that manages external API resources. Imagine you have a third-party service (like a hypothetical partner platform) that you want to provision accounts for whenever a CloudFormation stack is created.

First, here's the Lambda handler in Python:

```python
import json
import urllib3
import os
from datetime import datetime

http = urllib3.PoolManager()

def lambda_handler(event, context):
    print(f"Received event: {json.dumps(event)}")
    
    request_type = event['RequestType']
    physical_resource_id = event.get('PhysicalResourceId', str(datetime.now().timestamp()))
    response_url = event['ResponseURL']
    
    try:
        resource_properties = event['ResourceProperties']
        api_token = os.environ['API_TOKEN']
        external_api_url = os.environ['EXTERNAL_API_URL']
        
        if request_type == 'Create':
            physical_resource_id = create_resource(resource_properties, api_token, external_api_url)
            
        elif request_type == 'Update':
            physical_resource_id = update_resource(physical_resource_id, resource_properties, api_token, external_api_url)
            
        elif request_type == 'Delete':
            delete_resource(physical_resource_id, api_token, external_api_url)
        
        send_response(response_url, 'SUCCESS', physical_resource_id, event, {
            'ResourceId': physical_resource_id,
            'Timestamp': str(datetime.now())
        })
        
    except Exception as e:
        print(f"Error: {str(e)}")
        send_response(response_url, 'FAILED', physical_resource_id, event, {}, str(e))

def create_resource(properties, api_token, api_url):
    account_name = properties.get('AccountName', 'default')
    
    headers = {
        'Authorization': f'Bearer {api_token}',
        'Content-Type': 'application/json'
    }
    
    body = json.dumps({
        'account_name': account_name,
        'tags': properties.get('Tags', {})
    })
    
    response = http.request(
        'POST',
        f'{api_url}/accounts',
        body=body,
        headers=headers
    )
    
    if response.status != 201:
        raise Exception(f"Failed to create account: {response.data.decode()}")
    
    result = json.loads(response.data.decode())
    return result['account_id']

def update_resource(physical_resource_id, properties, api_token, api_url):
    account_name = properties.get('AccountName', 'default')
    
    headers = {
        'Authorization': f'Bearer {api_token}',
        'Content-Type': 'application/json'
    }
    
    body = json.dumps({
        'account_name': account_name
    })
    
    response = http.request(
        'PATCH',
        f'{api_url}/accounts/{physical_resource_id}',
        body=body,
        headers=headers
    )
    
    if response.status not in [200, 204]:
        raise Exception(f"Failed to update account: {response.data.decode()}")
    
    return physical_resource_id

def delete_resource(physical_resource_id, api_token, api_url):
    headers = {
        'Authorization': f'Bearer {api_token}'
    }
    
    response = http.request(
        'DELETE',
        f'{api_url}/accounts/{physical_resource_id}',
        headers=headers
    )
    
    if response.status not in [200, 204, 404]:
        raise Exception(f"Failed to delete account: {response.data.decode()}")

def send_response(url, status, physical_resource_id, event, data, reason=''):
    response_body = {
        'Status': status,
        'PhysicalResourceId': physical_resource_id,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': data
    }
    
    if reason:
        response_body['Reason'] = reason
    
    encoded_body = json.dumps(response_body).encode('utf-8')
    
    http.request(
        'PUT',
        url,
        body=encoded_body,
        headers={'Content-Type': 'application/json'}
    )
```

Now, here's the CloudFormation template that uses this custom resource:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Example of custom resource managing external API'

Parameters:
  AccountName:
    Type: String
    Default: my-external-account
    Description: Name for the external account

Resources:
  CustomResourceLambdaRole:
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

  CustomResourceLambda:
    Type: AWS::Lambda::Function
    Properties:
      Runtime: python3.11
      Handler: index.lambda_handler
      Role: !GetAtt CustomResourceLambdaRole.Arn
      Timeout: 60
      Environment:
        Variables:
          API_TOKEN: !Sub '{{resolve:secretsmanager:external-api-token:SecretString:token}}'
          EXTERNAL_API_URL: https://api.example.com
      Code:
        ZipFile: |
          # (handler code here)

  ExternalResource:
    Type: AWS::CloudFormation::CustomResource
    Properties:
      ServiceToken: !GetAtt CustomResourceLambda.Arn
      AccountName: !Ref AccountName
      Tags:
        Environment: Production
        ManagedBy: CloudFormation

Outputs:
  ExternalResourceId:
    Description: ID of the created external resource
    Value: !GetAtt ExternalResource.ResourceId
  ResourceTimestamp:
    Description: When the resource was created
    Value: !GetAtt ExternalResource.Timestamp
```

This example demonstrates several important patterns. The Lambda function uses environment variables to store sensitive configuration like API tokens. The handler carefully implements all three operation types. The template uses `!GetAtt` to retrieve data from the custom resource via the `Data` object returned by the handler, making that data available to other CloudFormation resources or outputs.

### Returning Data via the Data Object

The `Data` object in your response is how you communicate values back to CloudFormation. Any keys and values you include in the `Data` object can be retrieved by other resources in your template using the `Fn::GetAtt` intrinsic function.

This is powerful because it allows your custom resource to not just create external resources, but to pass information about those resources back to CloudFormation, where it can be used to configure other resources. For example, your custom resource might return an API endpoint URL that should be passed to an application environment variable.

In the example above, the Lambda handler returns:

```python
{
    'ResourceId': physical_resource_id,
    'Timestamp': str(datetime.now())
}
```

And the CloudFormation template retrieves these values with:

```yaml
!GetAtt ExternalResource.ResourceId
!GetAtt ExternalResource.Timestamp
```

You can return any JSON-serializable data in the `Data` object. Complex nested structures work fine. CloudFormation will make these values available for reference throughout your template, enabling powerful integration patterns where your custom resource can influence the rest of your infrastructure configuration.

### Error Handling and Recovery Strategies

Robust error handling separates production-quality custom resources from fragile ones. Your handler needs to gracefully handle failures, provide meaningful error messages, and clean up partial state when something goes wrong.

The basic pattern is straightforward: wrap your operation logic in a try-except block, and if an exception occurs, send a `FAILED` response with a descriptive reason. CloudFormation will mark the stack update as failed and, importantly, preserve the current state of your custom resource so you can investigate and retry.

However, there are subtleties worth understanding. When a custom resource creation fails, CloudFormation leaves the stack in a `CREATE_FAILED` state. The custom resource exists in CloudFormation's database with no `PhysicalResourceId` (or whatever partial ID you assigned). This means you can retry the stack creation, and if your handler succeeds on the retry, you can proceed. Importantly, if you partially created an external resource before failing, you need to clean it up yourself or idempotently handle re-creation.

One approach is to make your create operation idempotent using external state. For example, if you're provisioning a third-party account, check if an account with the same name already exists. If it does, use the existing account and return its ID. This way, if your handler was partially successful before failing, a retry can detect and use the existing resource.

For update operations that fail, CloudFormation keeps the old `PhysicalResourceId` in place. If your update partially succeeded before failing, this can be problematic. Consider whether your update operations need to be reversible, or whether you should implement them as replacement operations (creating a new resource and letting CloudFormation delete the old one).

For delete operations, failure is particularly important to handle correctly. If deletion fails, CloudFormation will keep the stack in a `DELETE_FAILED` state, and the physical resource remains associated with the stack. You should ensure that your delete operation is idempotent—if you try to delete a resource that's already gone, that should be treated as success. In the Python example above, notice that a 404 response from the API (indicating the resource doesn't exist) is treated as success, not failure.

Always add comprehensive logging to your handler. Use CloudWatch Logs to track what's happening in production. Log the incoming event, significant milestones during processing, and error details. This is invaluable for debugging issues.

```python
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    logger.info(f"Starting custom resource handler for {event['RequestType']} on {event['LogicalResourceId']}")
    logger.info(f"Physical resource ID: {event.get('PhysicalResourceId', 'NEW')}")
    
    # ... operation code ...
    
    logger.info(f"Operation completed successfully with ID: {physical_resource_id}")
```

### SNS-Backed Custom Resources: An Alternative Approach

While Lambda is the most common choice for custom resources, SNS provides an alternative that's useful in specific scenarios. An SNS-backed custom resource publishes the request message to an SNS topic, and you can have one or more subscribers (Lambda functions, SQS queues, HTTP endpoints, etc.) process the request asynchronously.

The advantage of SNS is decoupling. Your custom resource processing is no longer synchronous, and you can have multiple subscribers handling requests in parallel or in different ways. This is useful if you need to integrate with external systems that can't respond quickly, or if you want to implement a queue-based processing model.

The disadvantage is complexity in response handling. Since SNS doesn't inherently support request-response patterns, you need to manually handle sending responses back to CloudFormation via the ResponseURL. You also need to implement your own timeout handling—CloudFormation will wait up to one hour for a response before timing out and marking the operation as failed.

Here's how an SNS-based custom resource looks in CloudFormation:

```yaml
MyCustomResource:
  Type: AWS::CloudFormation::CustomResource
  Properties:
    ServiceToken: !GetAtt CustomResourceTopic.TopicArn
    SomeProperty: SomeValue
```

And a Lambda function subscribing to that topic might look like:

```python
def sns_handler(event, context):
    message = json.loads(event['Records'][0]['Sns']['Message'])
    
    request_type = message['RequestType']
    response_url = message['ResponseURL']
    
    try:
        # ... perform operation based on request_type ...
        
        send_response(response_url, 'SUCCESS', physical_resource_id, message, data)
    except Exception as e:
        send_response(response_url, 'FAILED', physical_resource_id, message, {}, str(e))
```

The SNS approach requires more infrastructure setup and careful handling of asynchronous responses. For most use cases, Lambda-backed custom resources are simpler and preferable.

### Best Practices for Production Custom Resources

Building custom resources that will reliably operate in production environments requires attention to several important practices.

First, always implement timeouts. Your Lambda function should have a timeout set appropriately for the external operation. If you're calling a third-party API, know how long it typically takes and set a timeout a bit longer than that. CloudFormation has its own timeout (one hour for Lambda-backed resources), but you should fail fast if your operation is taking too long, allowing CloudFormation to mark the operation as failed and let you know something's wrong.

Second, implement retry logic for transient failures. If calling an external API and getting a 503 Service Unavailable response, you might want to retry a few times before failing. Use exponential backoff to avoid overwhelming the external system. The `requests` library has built-in retry mechanisms, or you can implement them manually using `time.sleep()`.

Third, always validate your inputs. CloudFormation allows you to define any properties on a custom resource, but it doesn't validate them. You should check that required properties are present and have valid values. Return a FAILED response immediately if validation fails, giving operators clear feedback about what's wrong with their template.

Fourth, consider using secrets management for sensitive data. Don't store API tokens or passwords in environment variables directly if you can avoid it. Use AWS Secrets Manager and reference secrets from within your Lambda handler. In the example above, this was done using parameter substitution, but you could also call the Secrets Manager API from within your handler.

Fifth, test your custom resources thoroughly. This is harder than testing regular Lambda functions because you need to actually trigger them through CloudFormation. Create test stacks and exercise the create, update, and delete paths. Test failure scenarios to ensure your error handling works correctly.

Sixth, monitor your custom resources in production. Set up CloudWatch alarms on Lambda invocation metrics, error rates, and duration. Monitor the external service you're integrating with to catch failures on their side. Consider implementing X-Ray tracing to understand latency and failure points.

Finally, document your custom resource's behavior. What properties does it accept? What data does it return? What are the idempotency guarantees? What happens on update—is it a replacement or in-place? Your team will appreciate clear documentation, and your future self will thank you when troubleshooting in production.

### Debugging Custom Resources

When things go wrong, debugging custom resources requires understanding where failures occur. CloudFormation provides the stack events view, which shows whether a custom resource operation succeeded or failed and the reason for failure. Check the CloudFormation console or use the AWS CLI to view stack events:

```bash
aws cloudformation describe-stack-events --stack-name my-stack
```

Look for events related to your custom resource. If there's a failure, the event details should include the reason from your handler's `Reason` field.

For more detailed debugging, check CloudWatch Logs. Your Lambda handler's logs contain whatever print statements or logger calls you've added. This is where you'll see the detailed error messages and operation flow.

A common issue is the Lambda function timing out. If your external operation takes longer than the Lambda timeout, you'll see a timeout error. Increase the Lambda timeout to match the expected operation duration, but remember that CloudFormation itself will timeout after one hour.

Another common issue is the ResponseURL becoming invalid. CloudFormation generates a presigned S3 URL that's valid for a specific time period. If your handler takes too long to complete and then tries to send the response, the URL might have expired. Ensure you're responding within a reasonable timeframe.

If you're updating a custom resource and CloudFormation is replacing it instead of updating it, check that your handler returns the same `PhysicalResourceId` on update. If it returns a different ID, CloudFormation interprets that as needing to create a new resource.

### Conclusion

Custom resources transform CloudFormation from a tool for managing AWS infrastructure into a flexible orchestration platform that can coordinate your entire technology stack, including third-party systems and custom logic. By understanding the service token, the request/response envelope, and the proper handling of Create/Update/Delete operations, you can build robust integrations that extend CloudFormation's capabilities far beyond its native resource support.

The key insight is this: custom resources are a bridge between CloudFormation's declarative infrastructure model and imperative custom logic. They let you express infrastructure requirements in a CloudFormation template while deferring the actual implementation to code you control. This enables patterns like third-party service provisioning, prerequisites validation, dynamic value generation, and sophisticated resource cleanup—all declaratively defined in your templates.

As you build custom resources, focus on idempotency, clear error handling, and comprehensive logging. Test your handlers thoroughly, both for success and failure paths. Monitor them in production. And remember that custom resources are part of your infrastructure as code—they deserve the same care, testing, and documentation you'd apply to any other critical component of your system. With these practices in place, custom resources become a powerful and reliable tool for building sophisticated, flexible cloud infrastructure.
