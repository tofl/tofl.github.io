---
title: "Testing SAM Deployments with AWS SAM Tests and Smoke Tests"
---

## Testing SAM Deployments with AWS SAM Tests and Smoke Tests

Deploying an application is only half the battle. You can have a successful CloudFormation stack creation, green deployment status across the board, and still discover that your API returns garbage data or your Lambda function silently fails under real load. This is where testing your deployed SAM application becomes critical. Beyond validating that your infrastructure provisioned correctly, you need to verify that your application actually *works* the way you intended.

In this article, we'll explore how to build comprehensive tests for your deployed Serverless Application Model applications. We'll examine smoke testing strategies that go beyond CloudFormation stack status checks, learn how to assert behavior in your live endpoints, and discover how to integrate these tests into your CI/CD pipelines so that deployment failures are caught before they affect users.

### Understanding the Testing Gap

When you deploy a SAM application, the AWS CloudFormation service creates your resources and reports success when the stack reaches a `CREATE_COMPLETE` or `UPDATE_COMPLETE` state. But this tells you only that resources were provisioned—not that they work together correctly. Your Lambda function might be misconfigured, your API Gateway might have incorrect IAM permissions, or your database connection might be failing silently.

Consider a common scenario: you deploy a REST API backed by Lambda functions that read from DynamoDB. CloudFormation succeeds, all resources exist, but your function's IAM role doesn't actually have permissions to query the table. Without smoke tests, you'd only discover this when a user hits the endpoint in production.

Smoke tests fill this critical gap. They validate your deployed application's behavior in its actual environment, using the real AWS services and configurations. They're integration tests that run *after* deployment, confirming that your application not only exists but functions as intended.

### What Makes an Effective Smoke Test?

Smoke tests should be lightweight, focused, and fast. They're not comprehensive end-to-end tests covering every edge case—that's the job of your unit and integration tests. Instead, smoke tests verify the critical path: Can I call my API? Does it return the correct status code? Does the response have the expected structure? Can I invoke my Lambda function and observe its side effects?

A good smoke test typically exercises the happy path through your application, making a few key assertions about the result. It should run in seconds, not minutes, because you're running it in your CI/CD pipeline after every deployment. And it should be resilient to temporary glitches while still catching real problems—if your function takes three seconds to initialize after deployment, your test shouldn't fail because of a temporary timeout.

### Setting Up Your Test Environment

Before writing smoke tests, you need to know what you're testing. Your SAM template defines your application's outputs—API Gateway URLs, Lambda function names, and other deployed resource identifiers. You'll want to expose these outputs so your tests can discover them.

In your `template.yaml`, define outputs for any resources your tests need to access:

```yaml
Outputs:
  GetUserApi:
    Description: "API Gateway endpoint for GetUser function"
    Value: !Sub "https://${ServerlessApi}.execute-api.${AWS::Region}.amazonaws.com/Prod/users/"
    
  CreateUserFunction:
    Description: "Name of the CreateUser Lambda function"
    Value: !Ref CreateUserFunction
    
  UsersTable:
    Description: "Name of the DynamoDB table"
    Value: !Ref UsersTable
```

When your SAM application deploys, CloudFormation stores these outputs in the stack. Your test suite can then query the stack to retrieve the actual deployed resource identifiers:

```python
import boto3
import json

cloudformation = boto3.client('cloudformation')

def get_stack_outputs(stack_name):
    """Retrieve outputs from a deployed CloudFormation stack."""
    response = cloudformation.describe_stacks(StackName=stack_name)
    stack = response['Stacks'][0]
    
    outputs = {}
    for output in stack.get('Outputs', []):
        outputs[output['OutputKey']] = output['OutputValue']
    
    return outputs

# Usage
stack_name = 'my-serverless-app-prod'
outputs = get_stack_outputs(stack_name)
api_endpoint = outputs['GetUserApi']
```

This approach makes your tests environment-agnostic. Whether you're testing in development, staging, or production, your test code queries the actual deployed resources rather than assuming fixed names or endpoints.

### Testing API Endpoints

The most straightforward smoke test validates that your API endpoints respond correctly. You'll typically make an HTTP request to your endpoint and assert on the response status code and body structure.

Here's a practical example in Python using the `requests` library:

```python
import requests
import json
import pytest

class TestUserApi:
    @pytest.fixture(scope="module", autouse=True)
    def setup(self):
        """Set up test fixtures with deployed resource identifiers."""
        outputs = get_stack_outputs('my-serverless-app-prod')
        self.api_endpoint = outputs['GetUserApi']
    
    def test_get_user_success(self):
        """Verify that GetUser endpoint returns valid data."""
        user_id = '12345'
        response = requests.get(f'{self.api_endpoint}{user_id}')
        
        assert response.status_code == 200
        data = response.json()
        assert 'userId' in data
        assert 'name' in data
        assert 'email' in data
        assert data['userId'] == user_id
    
    def test_get_user_not_found(self):
        """Verify that GetUser returns 404 for nonexistent user."""
        response = requests.get(f'{self.api_endpoint}nonexistent-id')
        assert response.status_code == 404
    
    def test_create_user_validates_input(self):
        """Verify that CreateUser rejects invalid input."""
        response = requests.post(
            f'{self.api_endpoint}',
            json={'name': 'John'}  # Missing required 'email' field
        )
        assert response.status_code == 400
        error = response.json()
        assert 'email' in error['message'].lower()
```

Notice that these tests validate not just happy-path behavior but also error cases. A deployed application should gracefully handle bad input, and smoke tests should confirm this.

The equivalent in Node.js using the `axios` library:

```javascript
const axios = require('axios');
const AWS = require('aws-sdk');

const cloudformation = new AWS.CloudFormation();

async function getStackOutputs(stackName) {
    const response = await cloudformation.describeStacks({ StackName: stackName }).promise();
    const outputs = {};
    response.Stacks[0].Outputs.forEach(output => {
        outputs[output.OutputKey] = output.OutputValue;
    });
    return outputs;
}

describe('User API Smoke Tests', () => {
    let apiEndpoint;

    beforeAll(async () => {
        const outputs = await getStackOutputs('my-serverless-app-prod');
        apiEndpoint = outputs.GetUserApi;
    });

    test('GetUser endpoint returns valid user data', async () => {
        const userId = '12345';
        const response = await axios.get(`${apiEndpoint}${userId}`);

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('userId', userId);
        expect(response.data).toHaveProperty('name');
        expect(response.data).toHaveProperty('email');
    });

    test('GetUser returns 404 for nonexistent user', async () => {
        try {
            await axios.get(`${apiEndpoint}nonexistent-id`);
            fail('Expected 404 error');
        } catch (error) {
            expect(error.response.status).toBe(404);
        }
    });

    test('CreateUser rejects invalid input', async () => {
        try {
            await axios.post(apiEndpoint, { name: 'John' });
            fail('Expected 400 error');
        } catch (error) {
            expect(error.response.status).toBe(400);
        }
    });
});
```

When writing API tests, be thoughtful about what data you use. For smoke tests, you're typically working with real deployed infrastructure, so avoid creating test data that pollutes your production database. Instead, consider using a separate test user account or environment, or design your tests to be idempotent (safe to run multiple times).

### Testing Lambda Function Behavior

Not all serverless applications expose API endpoints. Some Lambda functions are triggered by events—SNS messages, S3 uploads, or scheduled events. For these, you'll invoke the function directly using the AWS SDK and verify its behavior.

Here's how to test a Lambda function that processes messages and writes results to DynamoDB:

```python
import boto3
import json
import time

lambda_client = boto3.client('lambda')
dynamodb = boto3.resource('dynamodb')

def test_process_message_function():
    """Test that ProcessMessage Lambda correctly processes input."""
    outputs = get_stack_outputs('my-serverless-app-prod')
    function_name = outputs['ProcessMessageFunction']
    table_name = outputs['ProcessedMessagesTable']
    
    # Prepare test event
    test_event = {
        'messageId': 'test-msg-123',
        'content': 'Hello, world!',
        'timestamp': int(time.time())
    }
    
    # Invoke the function
    response = lambda_client.invoke(
        FunctionName=function_name,
        InvocationType='RequestResponse',
        Payload=json.dumps(test_event)
    )
    
    # Verify the Lambda response
    assert response['StatusCode'] == 200
    payload = json.loads(response['Payload'].read())
    assert payload['statusCode'] == 200
    assert 'messageId' in payload['body']
    
    # Verify side effects (data written to DynamoDB)
    time.sleep(1)  # Allow time for write operation
    table = dynamodb.Table(table_name)
    item = table.get_item(Key={'messageId': 'test-msg-123'})
    assert 'Item' in item
    assert item['Item']['status'] == 'processed'
```

In this test, we're not just checking that the Lambda function returns successfully—we're also verifying its side effects. The function should write to DynamoDB, and we confirm that the data actually appears in the table with the expected values.

The Node.js equivalent:

```javascript
const AWS = require('aws-sdk');

const lambda = new AWS.Lambda();
const dynamodb = new AWS.DynamoDB.DocumentClient();

async function testProcessMessageFunction() {
    const outputs = await getStackOutputs('my-serverless-app-prod');
    const functionName = outputs.ProcessMessageFunction;
    const tableName = outputs.ProcessedMessagesTable;

    const testEvent = {
        messageId: 'test-msg-123',
        content: 'Hello, world!',
        timestamp: Math.floor(Date.now() / 1000)
    };

    // Invoke the function
    const response = await lambda.invoke({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(testEvent)
    }).promise();

    expect(response.StatusCode).toBe(200);
    const payload = JSON.parse(response.Payload);
    expect(payload.statusCode).toBe(200);

    // Wait for eventual consistency and verify side effects
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const item = await dynamodb.get({
        TableName: tableName,
        Key: { messageId: 'test-msg-123' }
    }).promise();

    expect(item.Item).toBeDefined();
    expect(item.Item.status).toBe('processed');
}
```

When testing Lambda function side effects, be aware of eventual consistency. If your function writes to DynamoDB and you immediately query for the result, you might get a stale response. A brief pause (one to two seconds) usually suffices for smoke tests.

### Verifying Resource Creation and Configuration

Sometimes you want to verify that resources were created correctly and have the expected configuration. This goes beyond testing application behavior and into infrastructure validation.

For example, you might want to confirm that your Lambda function has specific environment variables set, that its timeout is configured correctly, or that it has the right IAM permissions:

```python
import boto3

lambda_client = boto3.client('lambda')
iam_client = boto3.client('iam')

def test_lambda_configuration():
    """Verify Lambda function is configured correctly."""
    outputs = get_stack_outputs('my-serverless-app-prod')
    function_name = outputs['ProcessMessageFunction']
    
    # Get function configuration
    config = lambda_client.get_function_configuration(FunctionName=function_name)
    
    # Verify timeout and memory
    assert config['Timeout'] == 60, "Function should have 60 second timeout"
    assert config['MemorySize'] == 512, "Function should have 512 MB memory"
    
    # Verify environment variables
    env_vars = config.get('Environment', {}).get('Variables', {})
    assert env_vars.get('LOG_LEVEL') == 'INFO'
    assert env_vars.get('TABLE_NAME') is not None
    
    # Verify IAM role has DynamoDB permissions
    role_name = config['Role'].split('/')[-1]
    inline_policies = iam_client.list_role_policies(RoleName=role_name)
    
    assert len(inline_policies['PolicyNames']) > 0, "Role should have policies attached"
    
    # Get and verify a specific policy
    policy = iam_client.get_role_policy(
        RoleName=role_name,
        PolicyName='DynamoDBAccess'
    )
    policy_doc = policy['PolicyDocument']
    actions = policy_doc['Statement'][0]['Action']
    assert 'dynamodb:GetItem' in actions
    assert 'dynamodb:PutItem' in actions
```

And in Node.js:

```javascript
async function testLambdaConfiguration() {
    const outputs = await getStackOutputs('my-serverless-app-prod');
    const functionName = outputs.ProcessMessageFunction;

    const config = await lambda.getFunctionConfiguration({ FunctionName: functionName }).promise();

    expect(config.Timeout).toBe(60);
    expect(config.MemorySize).toBe(512);

    const envVars = config.Environment?.Variables || {};
    expect(envVars.LOG_LEVEL).toBe('INFO');
    expect(envVars.TABLE_NAME).toBeDefined();

    // Verify IAM role
    const roleName = config.Role.split('/').pop();
    const policies = await iam.listRolePolicies({ RoleName: roleName }).promise();
    expect(policies.PolicyNames.length).toBeGreaterThan(0);

    const policy = await iam.getRolePolicy({
        RoleName: roleName,
        PolicyName: 'DynamoDBAccess'
    }).promise();

    const actions = policy.PolicyDocument.Statement[0].Action;
    expect(actions).toContain('dynamodb:GetItem');
    expect(actions).toContain('dynamodb:PutItem');
}
```

These configuration tests help catch deployment issues early. If your SAM template has a typo that results in a Lambda function without the required environment variable, you'll know immediately rather than discovering it when the function fails at runtime.

### Monitoring and Metrics Validation

For critical functions, you might want to verify that CloudWatch metrics indicate healthy operation. This can catch issues that aren't immediately obvious—a function that's invoked successfully but takes unexpectedly long, or one that has a high error rate.

```python
import boto3
from datetime import datetime, timedelta

cloudwatch = boto3.client('cloudwatch')

def test_lambda_metrics():
    """Verify Lambda function metrics indicate healthy operation."""
    outputs = get_stack_outputs('my-serverless-app-prod')
    function_name = outputs['ProcessMessageFunction']
    
    # Query CloudWatch metrics for the last 5 minutes
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(minutes=5)
    
    # Check invocations
    invocations = cloudwatch.get_metric_statistics(
        Namespace='AWS/Lambda',
        MetricName='Invocations',
        Dimensions=[{'Name': 'FunctionName', 'Value': function_name}],
        StartTime=start_time,
        EndTime=end_time,
        Period=300,
        Statistics=['Sum']
    )
    
    assert len(invocations['Datapoints']) > 0, "Function should have been invoked"
    total_invocations = invocations['Datapoints'][0]['Sum']
    assert total_invocations > 0
    
    # Check errors
    errors = cloudwatch.get_metric_statistics(
        Namespace='AWS/Lambda',
        MetricName='Errors',
        Dimensions=[{'Name': 'FunctionName', 'Value': function_name}],
        StartTime=start_time,
        EndTime=end_time,
        Period=300,
        Statistics=['Sum']
    )
    
    total_errors = errors['Datapoints'][0]['Sum'] if errors['Datapoints'] else 0
    error_rate = (total_errors / total_invocations) * 100 if total_invocations > 0 else 0
    
    assert error_rate < 5, f"Error rate is {error_rate}%, should be less than 5%"
    
    # Check duration
    duration = cloudwatch.get_metric_statistics(
        Namespace='AWS/Lambda',
        MetricName='Duration',
        Dimensions=[{'Name': 'FunctionName', 'Value': function_name}],
        StartTime=start_time,
        EndTime=end_time,
        Period=300,
        Statistics=['Average']
    )
    
    if duration['Datapoints']:
        avg_duration = duration['Datapoints'][0]['Average']
        assert avg_duration < 5000, f"Average duration is {avg_duration}ms, should be less than 5 seconds"
```

Metrics validation is particularly useful for smoke tests that run continuously in your environment. If performance degrades or error rates spike, these tests will catch it.

### Integrating Smoke Tests into CI/CD Pipelines

Smoke tests are most valuable when they run automatically after every deployment. Integration into your CI/CD pipeline ensures that bad deployments never go unnoticed.

Here's how you might structure this in AWS CodePipeline with CodeBuild:

```yaml
# In your template.yaml or buildspec.yml
phases:
  post_build:
    commands:
      - echo "Running smoke tests against deployed application..."
      - aws cloudformation describe-stacks --stack-name my-serverless-app-prod --query 'Stacks[0].Outputs' > /tmp/stack-outputs.json
      - pip install -r tests/requirements.txt
      - pytest tests/smoke/ -v --tb=short
      - if [ $? -ne 0 ]; then echo "Smoke tests failed"; exit 1; fi
```

For a more sophisticated approach, consider a separate CodePipeline stage that runs only after successful deployment:

```yaml
# In your pipeline configuration
Stages:
  - Name: Deploy
    Actions:
      - Name: CreateChangeSet
        ActionTypeId:
          Category: Deploy
          Owner: AWS
          Provider: CloudFormation
          Version: '1'
      - Name: ExecuteChangeSet
        ActionTypeId:
          Category: Deploy
          Owner: AWS
          Provider: CloudFormation
          Version: '1'
  
  - Name: SmokeTests
    Actions:
      - Name: RunSmokeTests
        ActionTypeId:
          Category: Build
          Owner: AWS
          Provider: CodeBuild
          Version: '1'
        Configuration:
          ProjectName: my-app-smoke-tests
          EnvironmentVariablesOverride:
            - name: STACK_NAME
              value: my-serverless-app-prod
```

In your CodeBuild project, structure your test execution to fail the build if any smoke test fails:

```bash
#!/bin/bash
set -e

echo "Fetching stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs' \
  --output json)

echo "Installing dependencies..."
pip install -r tests/requirements.txt

echo "Running smoke tests..."
pytest tests/smoke/ \
  -v \
  --tb=short \
  --junit-xml=test-results.xml \
  --cov=tests/smoke \
  --cov-report=xml

echo "Smoke tests passed!"
```

This approach ensures that if your smoke tests fail, the deployment pipeline stops and prevents the bad code from progressing to the next environment.

### Best Practices for Reliable Smoke Tests

As you develop your smoke tests, keep a few key principles in mind. First, tests should be *deterministic*—they should produce the same result every time, without relying on timing or random data. Use fixed test data or clean up resources after each test run.

Second, keep tests *isolated*. If you're creating test data, make sure each test can run independently without depending on previous test runs. If tests need to run sequentially, make that explicit and document why.

Third, ensure tests are *resilient to timing*. Cloud operations aren't instantaneous. When you invoke a Lambda function that writes to DynamoDB, a brief delay before querying the result is expected. Build in reasonable waits (typically one to two seconds) rather than assuming instant consistency.

Fourth, use *appropriate assertions*. Don't just check that a request succeeded; verify the response structure and key data. This catches subtle bugs where the endpoint returns data but it's malformed or incomplete.

Finally, keep smoke tests *focused and fast*. Each test should exercise a single logical path through your application. Run your entire smoke test suite in under a minute if possible. If tests take longer, they won't run frequently enough to catch problems quickly.

### Handling Different Environments

As your application moves through development, staging, and production, smoke tests should adapt to each environment. Rather than hardcoding environment-specific details, parameterize your test suite:

```python
import os
import pytest

@pytest.fixture(scope="session")
def stack_name():
    """Get the stack name from environment variable."""
    env = os.getenv('ENVIRONMENT', 'dev')
    return f'my-serverless-app-{env}'

@pytest.fixture(scope="session")
def outputs(stack_name):
    """Retrieve outputs for the target stack."""
    return get_stack_outputs(stack_name)

def test_get_user_success(outputs):
    """Test that works with any deployed environment."""
    api_endpoint = outputs['GetUserApi']
    response = requests.get(f'{api_endpoint}test-user')
    assert response.status_code == 200
```

This way, the same test code works against development, staging, and production—you just change the environment variable. This reduces duplication and ensures consistency across environments.

### Conclusion

Smoke tests are an essential safety net for serverless applications. They bridge the gap between infrastructure provisioning and actual application behavior, catching deployment issues that CloudFormation status checks would miss. By testing your API endpoints, verifying Lambda function behavior, validating resource configuration, and monitoring metrics, you gain confidence that your deployed application actually works.

The key to effective smoke testing is automation. Integrate these tests into your CI/CD pipeline so they run after every deployment, providing immediate feedback. Use your test code to query deployed resources dynamically, avoiding hardcoded assumptions. Write tests that verify not just the happy path but also error conditions and edge cases. And keep tests focused, fast, and reliable so they provide genuine value rather than becoming a source of flaky failures.

With comprehensive smoke tests in place, you can deploy with confidence, knowing that bad deployments will be caught before they reach users.
