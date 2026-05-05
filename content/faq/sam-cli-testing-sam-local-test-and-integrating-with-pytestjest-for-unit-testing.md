---
title: "SAM CLI Testing: sam local test and Integrating with pytest/Jest for Unit Testing"
---

## SAM CLI Testing: sam local test and Integrating with pytest/Jest for Unit Testing

Testing serverless applications can feel like navigating a minefield. Your Lambda functions live in the cloud, they depend on AWS services you might not want to hit during development, and the local development loop can be slow if you're not careful. The AWS Serverless Application Model (SAM) CLI, combined with standard testing frameworks like pytest and Jest, gives you a powerful toolkit to validate your serverless code quickly and reliably—right on your laptop, without spinning up real AWS resources.

In this guide, we'll explore how to leverage SAM's testing capabilities alongside pytest for Python or Jest for Node.js. We'll walk through practical patterns for mocking AWS SDK calls, organizing your test suites, and building confidence in your Lambda functions before they touch production. Whether you're practicing test-driven development or adding tests to existing code, this hands-on approach will accelerate your development cycle and reduce surprises in production.

### Understanding SAM's Testing Approach

SAM isn't a testing framework in itself—rather, it's a scaffolding and local development tool that plays well with industry-standard testing libraries. When you initialize a SAM project, the generated template and function code are already set up with testing in mind.

The beauty of SAM's approach is its pragmatism. Instead of forcing you into a proprietary testing ecosystem, SAM respects the testing conventions that Python and Node.js developers already know. A SAM project initialized with `sam init` comes with a basic project structure that includes a `tests` directory, starter test files, and often includes dependencies for pytest (Python) or Jest (Node.js) already configured in the `requirements.txt` or `package.json`.

The `sam local invoke` command lets you run individual Lambda functions locally with test payloads, while frameworks like pytest and Jest let you write unit tests that run even faster by testing your handler logic in isolation—without spawning containers or waiting for AWS SDK initialization.

### Setting Up Your Testing Environment

Let's start with a concrete example. Suppose you're building a Lambda function that queries a DynamoDB table and returns item details. First, create a SAM project:

```bash
sam init --runtime python3.11 --dependency-manager pip --app-template hello-world
```

This generates a project structure like:

```
my-sam-app/
├── template.yaml
├── hello_world/
│   └── app.py
├── tests/
│   └── unit/
│       └── test_app.py
├── requirements.txt
└── README.md
```

For Python, your `requirements.txt` should include testing dependencies:

```
requests
boto3
pytest
pytest-mock
moto
```

The `moto` library is crucial here—it's a library that mocks AWS services, allowing your tests to run without hitting real AWS infrastructure. Similarly, for Node.js projects, your `package.json` should include:

```json
{
  "dependencies": {
    "aws-sdk": "^2.x.x"
  },
  "devDependencies": {
    "jest": "^29.x.x",
    "@aws-sdk/client-dynamodb": "^3.x.x"
  }
}
```

### Writing Unit Tests with pytest for Python Lambda Functions

Let's build a real example. Say your Lambda function queries DynamoDB:

```python
# hello_world/app.py
import json
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')

def lambda_handler(event, context):
    """
    Query a DynamoDB table and return item details
    """
    table_name = event.get('table_name', 'Items')
    item_id = event.get('item_id')
    
    if not item_id:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'item_id is required'})
        }
    
    try:
        table = dynamodb.Table(table_name)
        response = table.get_item(Key={'id': item_id})
        
        if 'Item' not in response:
            return {
                'statusCode': 404,
                'body': json.dumps({'error': 'Item not found'})
            }
        
        return {
            'statusCode': 200,
            'body': json.dumps(response['Item'])
        }
    except ClientError as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }
```

Now, here's a comprehensive test suite using pytest and moto:

```python
# tests/unit/test_app.py
import json
import pytest
import boto3
from moto import mock_dynamodb
from hello_world import app


@mock_dynamodb
def test_lambda_handler_returns_item_successfully():
    """Test successful retrieval of an item from DynamoDB"""
    # Set up a mock DynamoDB table
    dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
    table = dynamodb.create_table(
        TableName='Items',
        KeySchema=[{'AttributeName': 'id', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'id', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST'
    )
    
    # Insert test data
    table.put_item(Item={'id': 'item-123', 'name': 'Widget', 'price': 19.99})
    
    # Invoke the Lambda handler
    event = {'table_name': 'Items', 'item_id': 'item-123'}
    response = app.lambda_handler(event, None)
    
    # Assert the response
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['id'] == 'item-123'
    assert body['name'] == 'Widget'
    assert body['price'] == 19.99


@mock_dynamodb
def test_lambda_handler_missing_item_id():
    """Test that handler returns 400 when item_id is missing"""
    event = {'table_name': 'Items'}
    response = app.lambda_handler(event, None)
    
    assert response['statusCode'] == 400
    body = json.loads(response['body'])
    assert 'item_id is required' in body['error']


@mock_dynamodb
def test_lambda_handler_item_not_found():
    """Test that handler returns 404 when item doesn't exist"""
    dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
    dynamodb.create_table(
        TableName='Items',
        KeySchema=[{'AttributeName': 'id', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'id', 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST'
    )
    
    event = {'table_name': 'Items', 'item_id': 'nonexistent'}
    response = app.lambda_handler(event, None)
    
    assert response['statusCode'] == 404
    body = json.loads(response['body'])
    assert 'Item not found' in body['error']
```

The `@mock_dynamodb` decorator is the magic here. It intercepts all boto3 calls to DynamoDB and redirects them to moto's in-memory mock implementation. Your tests run in milliseconds without touching AWS, and you can focus on validating business logic.

Run your tests with:

```bash
pytest tests/unit/ -v
```

### Writing Unit Tests with Jest for Node.js Lambda Functions

For Node.js developers, the approach is similar but uses Jest and the AWS SDK mock libraries. Here's a comparable example:

```javascript
// src/app.js
const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });

exports.lambdaHandler = async (event, context) => {
    const tableName = event.table_name || 'Items';
    const itemId = event.item_id;
    
    if (!itemId) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'item_id is required' })
        };
    }
    
    try {
        const params = {
            TableName: tableName,
            Key: marshall({ id: itemId })
        };
        
        const command = new GetItemCommand(params);
        const response = await dynamoClient.send(command);
        
        if (!response.Item) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Item not found' })
            };
        }
        
        const item = unmarshall(response.Item);
        return {
            statusCode: 200,
            body: JSON.stringify(item)
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
```

And the Jest test suite:

```javascript
// tests/unit/test-app.js
const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { mockClient } = require("aws-sdk-client-mock");
const { marshall } = require("@aws-sdk/util-dynamodb");
const app = require('../../src/app');

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
    ddbMock.reset();
});

describe('Lambda Handler', () => {
    test('should return item successfully', async () => {
        const mockItem = { id: 'item-123', name: 'Widget', price: 19.99 };
        
        ddbMock.on(GetItemCommand).resolves({
            Item: marshall(mockItem)
        });
        
        const event = { table_name: 'Items', item_id: 'item-123' };
        const response = await app.lambdaHandler(event, null);
        
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body);
        expect(body.id).toBe('item-123');
        expect(body.name).toBe('Widget');
    });
    
    test('should return 400 when item_id is missing', async () => {
        const event = { table_name: 'Items' };
        const response = await app.lambdaHandler(event, null);
        
        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error).toContain('item_id is required');
    });
    
    test('should return 404 when item not found', async () => {
        ddbMock.on(GetItemCommand).resolves({});
        
        const event = { table_name: 'Items', item_id: 'nonexistent' };
        const response = await app.lambdaHandler(event, null);
        
        expect(response.statusCode).toBe(404);
        const body = JSON.parse(response.body);
        expect(body.error).toContain('Item not found');
    });
});
```

The `aws-sdk-client-mock` library provides a clean interface for mocking AWS SDK v3 calls. The `mockClient` function wraps DynamoDB commands, and you can use `.on()` and `.resolves()` to specify expected behavior.

Run Node.js tests with:

```bash
npm test
```

### Using sam local invoke for Integration Testing

While unit tests validate isolated business logic, `sam local invoke` lets you test your Lambda function with actual SAM infrastructure—environment variables, events, and the full handler context. This is useful for catching integration issues that unit tests might miss.

Create an event file, `events/event.json`:

```json
{
  "table_name": "Items",
  "item_id": "item-123"
}
```

Then invoke your function locally:

```bash
sam local invoke HelloWorldFunction -e events/event.json
```

SAM builds a Docker container image that mirrors the Lambda execution environment, runs your function, and returns the output. This is slower than unit tests but gives you confidence that your function behaves correctly when deployed.

You can also pass environment variables:

```bash
sam local invoke HelloWorldFunction \
  -e events/event.json \
  --env-vars env.json
```

Where `env.json` contains:

```json
{
  "Parameters": {
    "TABLE_NAME": "Items",
    "REGION": "us-east-1"
  }
}
```

### Testing Patterns and Best Practices

As you scale your testing, adopt these patterns:

**Organize tests by concern.** Separate unit tests (testing handler logic in isolation) from integration tests (testing with real AWS services or containers). A typical structure looks like `tests/unit/` and `tests/integration/`. Unit tests run fast and form your first line of defense; integration tests catch edge cases that mocks might miss.

**Mock AWS SDK calls consistently.** Always mock external dependencies—databases, message queues, APIs. Never let unit tests depend on real AWS resources. The cost of maintaining those resources and the time spent waiting for responses will slow your feedback loop. If you find yourself wanting to test against real AWS during development, use a dedicated sandbox AWS account separate from production.

**Test error paths as thoroughly as happy paths.** In the DynamoDB examples above, we tested missing parameters, missing items, and exceptions. Error handling is often where bugs hide. Use pytest's or Jest's parameterization to test multiple error scenarios concisely.

**Use fixtures for common setup.** In pytest, you can define fixtures to avoid repeating table creation and test data insertion:

```python
@pytest.fixture
def dynamodb_table():
    with mock_dynamodb():
        dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
        table = dynamodb.create_table(
            TableName='Items',
            KeySchema=[{'AttributeName': 'id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'id', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST'
        )
        yield table
```

Then reuse it across tests:

```python
def test_something(dynamodb_table):
    dynamodb_table.put_item(Item={'id': 'test', 'data': 'value'})
    # ... test code
```

**Keep tests focused and readable.** A test should validate one behavior. If you find yourself writing complex setup or assertions, consider splitting into multiple tests or extracting helpers. Test names should describe what they verify: `test_lambda_handler_returns_item_successfully` is clearer than `test_handler`.

**Run tests locally before pushing.** Make `pytest` or `npm test` part of your pre-commit hook or CI/CD pipeline. Catching bugs locally is infinitely cheaper than catching them in production.

### Debugging Test Failures

When a test fails, start by examining the test output carefully. Both pytest and Jest provide detailed error messages. If a mock assertion fails, it usually means your code isn't calling the AWS SDK method you expected, or is calling it with different parameters.

For pytest, use the `-v` (verbose) flag to see detailed output, or add `-s` to see print statements:

```bash
pytest tests/unit/test_app.py::test_lambda_handler_returns_item_successfully -vv -s
```

For Jest, use `--verbose` similarly:

```bash
npm test -- --verbose
```

If you're unsure whether your handler is even being called correctly, add temporary logging or use a debugger. Python's `pdb` works well with pytest:

```python
import pdb; pdb.set_trace()  # In your test or handler code
```

Then run with `pytest -s` to see the debugger prompt.

### Integrating Tests into Your Development Workflow

The goal is a tight feedback loop: write code, run tests, see results within seconds. Here's a practical workflow:

First, run your unit test suite frequently as you develop:

```bash
pytest tests/unit/ -v --tb=short
```

The `--tb=short` flag keeps stack traces concise. When your unit tests pass, use `sam local invoke` to test the full Lambda environment:

```bash
sam local invoke HelloWorldFunction -e events/event.json
```

Once local testing passes, you can deploy to a dev or staging environment and run integration tests against real AWS services (if you choose to write them). But the vast majority of your feedback should come from local unit tests—they're fast, reliable, and require no external setup.

### Common Pitfalls and How to Avoid Them

**Forgetting to mock AWS calls.** If your test calls real AWS (because you didn't import moto or didn't apply the decorator), it will fail mysteriously when you don't have AWS credentials configured, or worse, it might actually write to a real table. Always verify that your mocks are active—add an assertion that a mock was called to confirm.

**Testing implementation details instead of behavior.** Don't test that your handler calls `dynamodb.get_item()`. Test that given valid input, your function returns the expected output. This way, if you refactor to use a different AWS service, your test still validates the behavior.

**Creating brittle assertions.** Avoid asserting on exact strings or JSON structures that might change. Instead, assert on the presence of key fields and their types. For example, don't assert `body == '{"id":"item-123"}'`; assert the parsed body has the expected keys.

**Ignoring async/await in Node.js.** If you're testing async Lambda handlers in Node.js, ensure your test is async and properly awaits the handler. Missing an `await` will cause your test to exit before assertions run, leading to false positives.

### Conclusion

Testing serverless applications with SAM, pytest, Jest, and AWS mocking libraries turns development from a slow, cloud-dependent process into a fast, local iteration cycle. By writing unit tests that mock AWS SDK calls and using `sam local invoke` for more complete testing, you validate business logic quickly and confidently.

The patterns we've explored—mocking DynamoDB, organizing tests by concern, parameterizing test cases—apply across any Lambda-based architecture. Start by adding unit tests to new functions, gradually build a test suite, and make running tests part of your daily development rhythm. The small investment in testing infrastructure pays dividends in confidence, reduced debugging time, and fewer surprises in production.

As your serverless applications grow, you'll find that the speed and reliability of local testing becomes indispensable. You'll ship features faster, refactor with confidence, and spend less time firefighting production issues. That's the promise of thoughtful testing, and SAM with pytest or Jest is the toolkit to make it real.
