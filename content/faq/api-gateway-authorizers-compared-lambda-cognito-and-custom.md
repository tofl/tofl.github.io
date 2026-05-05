---
title: "API Gateway Authorizers Compared: Lambda, Cognito, and Custom"
---

## API Gateway Authorizers Compared: Lambda, Cognito, and Custom

When you deploy a REST API on AWS, one of your first security decisions is how to control who gets access to it. Amazon API Gateway provides multiple authorization mechanisms, each suited to different scenarios. Understanding these options—and knowing when to reach for each one—is critical for building secure, scalable APIs. This article walks you through the authorizer types available in API Gateway, how they work under the hood, and how to choose the right one for your application.

### What Is an Authorizer, and Why Does It Matter?

An authorizer is a component in API Gateway that validates incoming requests before they reach your backend. Rather than forcing every Lambda function or microservice to implement its own authentication and authorization logic, API Gateway can handle this responsibility centrally. This approach keeps your business logic clean, reduces code duplication, and makes it easier to enforce consistent security policies across your entire API.

When a client sends a request to a protected API endpoint, API Gateway intercepts it, passes it to the authorizer, and waits for a decision. The authorizer either grants access (along with some context about the request) or denies it. If access is granted, the request flows to your backend with additional metadata about who made the call and what they're allowed to do.

### The Authorization Flow: A High-Level View

Before diving into specific authorizer types, let's establish a mental model of how authorization works in API Gateway. When a request arrives, this sequence unfolds:

The client includes credentials in the request—perhaps a token in the Authorization header, an API key, or AWS credentials. API Gateway receives the request and checks whether the endpoint is protected by an authorizer. If it is, API Gateway invokes the authorizer with the request details. The authorizer validates the credentials and makes a decision: allow or deny. If the authorizer grants access, it can return additional context (authorization context) that gets injected into the request sent to your backend. Your backend receives the request, processes it using both the business logic and the injected context, and returns a response.

This flow is the same across all authorizer types, but the implementation and capabilities of each type differ significantly.

### Lambda Authorizers: Maximum Flexibility

Lambda authorizers, also called custom authorizers, give you the most control over authorization logic. When you attach a Lambda authorizer to an API Gateway method, API Gateway invokes a Lambda function you provide and passes the incoming request to it. Your function examines the request, validates tokens, checks permissions, or applies whatever custom logic you need, then returns an authorization decision along with optional context variables.

#### How Lambda Authorizers Work

When a request hits an endpoint protected by a Lambda authorizer, API Gateway extracts relevant parts of the request and passes them to your Lambda function. The function receives an event containing the method token (typically extracted from the Authorization header or query parameters) and details about the request like the HTTP method, resource path, and headers.

Here's a simplified example of what a Lambda authorizer event looks like:

```json
{
  "type": "TOKEN",
  "methodArn": "arn:aws:execute-api:us-east-1:123456789012:abcdef/prod/GET/pets",
  "authorizationToken": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Your Lambda function processes this event, validates the token (perhaps checking its signature against a known key, or querying a database), and returns an authorization policy document. If the token is valid, you return an Allow policy; if invalid, you return a Deny policy. You can also include context variables—arbitrary key-value pairs that get passed along to your backend.

Here's an example Lambda authorizer function in Python:

```python
import json
import jwt

def lambda_handler(event, context):
    token = event['authorizationToken']
    method_arn = event['methodArn']
    
    try:
        # Decode and validate the JWT token
        decoded = jwt.decode(token, 'your-secret-key', algorithms=['HS256'])
        user_id = decoded['sub']
        
        # Build the authorization policy
        policy = {
            'principalId': user_id,
            'policyDocument': {
                'Version': '2012-10-17',
                'Statement': [
                    {
                        'Action': 'execute:Invoke',
                        'Effect': 'Allow',
                        'Resource': method_arn
                    }
                ]
            },
            'context': {
                'userId': user_id,
                'email': decoded.get('email', ''),
                'role': decoded.get('role', 'user')
            }
        }
        
        return policy
        
    except jwt.InvalidTokenError:
        raise Exception('Unauthorized')
```

The context variables you return (userId, email, role) become available in your backend. If your backend is a Lambda function, these appear in the event object. If your backend is another service, API Gateway injects them as headers or path parameters depending on your configuration.

#### Caching of Authorization Decisions

One powerful feature of Lambda authorizers is decision caching. By default, API Gateway caches the authorizer's response for 300 seconds. This caching is keyed by the authorization token, which makes sense: if you've already validated a particular token as belonging to user Alice, you don't need to re-validate it for the next 300 seconds.

You can customize this TTL when configuring the authorizer. Setting it to 0 disables caching entirely, which is appropriate when your authorization decisions change frequently or when you need real-time revocation. Setting it higher (up to 3600 seconds) reduces the number of times your Lambda function invokes, lowering latency and costs, but you accept a window during which token revocation won't take effect immediately.

```python
# In your authorizer response, you can optionally include this:
'usageIdentifierKey': 'some-unique-key'
```

The `usageIdentifierKey` field lets you use the same token for multiple users or apply more granular caching logic, though this is an advanced pattern.

#### Choosing Lambda Authorizers

Lambda authorizers shine when you need custom logic that doesn't fit neatly into other models. If you're integrating with a legacy authentication system, applying complex role-based access control, or calling out to external services to validate permissions, a Lambda authorizer handles these scenarios well. They're also ideal for internal APIs within your organization where you control both the client and server.

The trade-off is operational complexity. You're responsible for maintaining the Lambda function, managing secrets (like token signing keys), handling failures gracefully, and monitoring performance. If the authorizer function becomes slow or crashes, it can degrade your entire API.

### Amazon Cognito User Pool Authorizers: Managed Identity

Amazon Cognito User Pools provide a managed authentication service that handles user registration, login, password resets, and multi-factor authentication out of the box. Cognito integrates natively with API Gateway, making it an excellent choice for applications that need a full-featured user management system without building one from scratch.

#### How Cognito User Pool Authorizers Work

When you configure a Cognito User Pool authorizer on an API Gateway method, you're telling API Gateway to trust tokens issued by a specific Cognito User Pool. A client first authenticates with your Cognito User Pool (using the Cognito API, an SDK, or a hosted UI). Upon successful authentication, Cognito issues three tokens: an ID token (containing user identity information), an access token (used for API calls), and a refresh token (used to obtain new tokens without re-authenticating).

The client then includes the access token in the Authorization header when calling your API. API Gateway receives the request, validates the token's signature against the Cognito User Pool's public key, checks that it hasn't expired, and allows or denies the request accordingly. If valid, API Gateway automatically injects claims from the token (like the user ID and custom attributes) as context variables into your backend request.

The validation is cryptographic and stateless—API Gateway doesn't need to call Cognito on every request. It downloads Cognito's public keys once and caches them, so token validation happens locally and quickly.

#### Authorization Context from Cognito

When Cognito validates a token, API Gateway extracts claims from the token and makes them available to your backend. By default, these include `claims.sub` (the unique user identifier), `claims.cognito:username`, and any custom attributes you've added to your user pool schema.

In your backend Lambda function, you might see context variables like:

```python
def handler(event, context):
    # Context variables injected by API Gateway
    request_context = event['requestContext']
    authorizer = request_context.get('authorizer', {})
    
    user_id = authorizer.get('claims', {}).get('sub')
    username = authorizer.get('claims', {}).get('cognito:username')
    custom_role = authorizer.get('claims', {}).get('custom:role')
    
    # Use these in your business logic
    return {
        'statusCode': 200,
        'body': json.dumps(f'Hello {username}')
    }
```

#### Cognito Caching

Like Lambda authorizers, Cognito authorizers also respect the caching TTL. The default is 300 seconds, and you can adjust it when configuring the authorizer. Since Cognito token validation is fast (it's just cryptographic verification), the caching benefit is less dramatic than with Lambda authorizers, but it still reduces load and latency.

#### Choosing Cognito User Pool Authorizers

Cognito User Pool authorizers are ideal when you need to manage a user base with features like self-service sign-up, password resets, and multi-factor authentication. They're perfect for external-facing applications like SaaS products or mobile apps where users create and manage their own accounts. Cognito handles the authentication ceremony, and your API Gateway simply validates the tokens.

The downside is that Cognito is opinionated about how authentication works. If your user management needs are highly specialized or you're integrating with an existing identity provider, you might need to use a Lambda authorizer instead. Also, Cognito tokens contain claims that your frontend must understand and use correctly; it's not a complete solution if your authorization logic depends on external databases or real-time permission checks.

### IAM Authorizers: AWS-Native Security

IAM (Identity and Access Management) authorizers leverage AWS's native identity system. When you use IAM authorization, clients must sign their requests using AWS Signature Version 4, the same mechanism used for direct AWS API calls. API Gateway validates these signatures and grants or denies access based on IAM policies attached to the requesting identity.

#### How IAM Authorization Works

For IAM authorization to work, the client must have AWS credentials (an access key and secret access key, or temporary credentials from STS). The client signs the request using Signature Version 4, which involves hashing the request body, creating a canonical request, and deriving a signature from the secret key.

When the request arrives at API Gateway, it validates the signature using the public key associated with the credentials. If valid, API Gateway checks the IAM policies attached to the requesting identity to determine if they have permission to invoke that specific API method.

For example, an IAM policy might look like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:execute-api:us-east-1:123456789012:abcdef/prod/GET/users/*"
    }
  ]
}
```

This policy grants permission to invoke the GET method on the `/users/*` resource within the specified API stage.

#### Choosing IAM Authorizers

IAM authorization is best suited for internal APIs or APIs called by other AWS services or applications running within your AWS environment. If you're building a microservices architecture where Lambda functions in one account or region call APIs in another, IAM provides a seamless, secure authorization mechanism without additional authentication layers.

IAM authorization is less suitable for external-facing APIs because it requires clients to manage AWS credentials, which is operationally complex for end users. It's also less flexible for fine-grained, application-level authorization logic; IAM policies work at the API level (which method can be invoked), not at the data level (which records a user can access).

### API Keys: Simple Access Control

API Keys are the simplest authorization mechanism API Gateway offers, though "authorization" is a generous term—they're really more of an access control mechanism. An API key is a simple string that clients include in the `x-api-key` header. API Gateway checks whether the key is valid and enabled; if so, the request proceeds. If not, it's rejected.

API Keys are primarily designed for basic access control and usage metering, not for identifying who is making the request. All clients using the same API key are treated identically. You can associate API keys with usage plans to enforce rate limiting and quotas, but there's no notion of user identity.

API Keys are useful for public APIs where you want to rate-limit or track usage by consumer, but you don't need fine-grained authorization. For anything more sophisticated, pair API keys with another authorizer.

### Choosing the Right Authorizer: A Decision Framework

With four different authorizer types available, how do you choose? The decision depends on your use case, the identity model you need, and your operational constraints.

**Use Lambda authorizers when you need maximum flexibility.** If your authorization logic is complex, domain-specific, or integrates with external systems, Lambda authorizers let you implement whatever logic you need. They're also appropriate when you're building internal APIs within your organization and you already have an authentication mechanism in place (like a corporate directory or legacy system).

**Use Cognito User Pool authorizers when you need managed user identity and authentication.** If you're building an external-facing application and want users to sign up, log in, and manage their accounts, Cognito handles the heavy lifting. The integration with API Gateway is seamless, and Cognito provides features like MFA, passwordless authentication, and social login out of the box.

**Use IAM authorizers for internal AWS-to-AWS communication.** If your clients are Lambda functions, EC2 instances, or other AWS services within your control, IAM authorization provides a secure, zero-trust mechanism without additional credential management. It's also the right choice when you're enforcing authorization at the AWS service level as part of a broader security strategy.

**Use API Keys for simple access control and usage metering.** If you need to track which consumers are using your API and enforce basic rate limits, API keys work. Combine them with another authorizer for actual authentication and identification.

Many real-world APIs combine multiple authorizers. A common pattern is to use API Keys as a first line of defense (to block obviously invalid requests quickly) and then layer Cognito or Lambda authorization for authenticated endpoints. API Gateway allows you to chain authorizers, giving you flexibility in how you compose your security strategy.

### Authorization Context: Injecting Identity into Your Backend

Regardless of which authorizer you choose, the fundamental mechanism for passing authorization information to your backend is context variables. These are key-value pairs that API Gateway injects into the request it forwards to your backend.

For Lambda authorizers, you control exactly what context variables are returned:

```python
'context': {
    'userId': 'user123',
    'department': 'engineering',
    'requestId': 'req-abc-123'
}
```

For Cognito authorizers, context variables are automatically extracted from the token:

```python
'claims': {
    'sub': 'user123',
    'cognito:username': 'alice',
    'email': 'alice@example.com',
    'custom:role': 'admin'
}
```

For IAM authorizers, the principal ID is the AWS account or IAM user/role that signed the request.

Your backend receives these in the `requestContext` field of the Lambda event:

```python
def handler(event, context):
    request_context = event['requestContext']
    authorizer_context = request_context.get('authorizer', {})
    
    # Use the context in your business logic
    user_id = authorizer_context.get('userId')
    # ... rest of your function
```

If your backend is not a Lambda function but an HTTP endpoint, API Gateway can inject context variables as HTTP headers, path parameters, or query string parameters, depending on your configuration. This flexibility allows you to integrate authorization information with any backend service.

### Real-World Example: Building an API with Lambda Authorization

Let's walk through a practical scenario: you're building an internal API for your company's HR system. You have an existing authentication mechanism (perhaps LDAP or a corporate identity provider), and you need to validate that users belong to specific departments before granting access to certain endpoints.

First, you'd build a Lambda authorizer that validates the incoming token against your identity provider:

```python
import json
import requests
import base64

def lambda_handler(event, context):
    token = event['authorizationToken']
    method_arn = event['methodArn']
    
    try:
        # Validate token against your corporate identity provider
        headers = {'Authorization': f'Bearer {token}'}
        response = requests.get('https://idp.company.com/validate', headers=headers)
        
        if response.status_code != 200:
            raise Exception('Unauthorized')
        
        user_info = response.json()
        
        # Build the authorization policy
        policy = {
            'principalId': user_info['user_id'],
            'policyDocument': {
                'Version': '2012-10-17',
                'Statement': [
                    {
                        'Action': 'execute:Invoke',
                        'Effect': 'Allow',
                        'Resource': method_arn
                    }
                ]
            },
            'context': {
                'userId': user_info['user_id'],
                'department': user_info['department'],
                'email': user_info['email']
            }
        }
        
        return policy
        
    except Exception as e:
        raise Exception('Unauthorized')
```

You'd then configure this Lambda function as a Lambda authorizer on your API Gateway, set an appropriate cache TTL (perhaps 600 seconds for your internal use case), and deploy.

When a user calls your API with a valid token, the authorizer validates it, returns the Allow policy with context variables, and API Gateway injects those variables into the request to your backend. Your backend Lambda function can then check the department context variable to enforce department-level access control:

```python
def hr_api_handler(event, context):
    # Get authorization context
    authorizer = event['requestContext'].get('authorizer', {})
    department = authorizer.get('department')
    user_id = authorizer.get('userId')
    
    # Enforce business logic based on department
    if event['resource'] == '/salaries' and department != 'hr':
        return {
            'statusCode': 403,
            'body': json.dumps('Access denied')
        }
    
    # Process the request
    return {
        'statusCode': 200,
        'body': json.dumps(f'Data for user {user_id}')
    }
```

This layered approach—authorization at the API Gateway level and fine-grained access control in your business logic—is a best practice that keeps your code clean and your security posture strong.

### Performance and Caching Considerations

Authorizer caching is critical for API performance. Every time you invoke an authorizer (whether Lambda or Cognito), there's latency. For Lambda authorizers, your function must execute, which might involve network calls to validate tokens or fetch user data. For Cognito, even though the validation is local, there's still overhead.

By caching authorization decisions for 300 seconds (the default), you dramatically reduce the number of authorizer invocations. For high-traffic APIs, this can reduce latency by 50ms or more per request, which compounds across thousands of requests per second.

However, longer cache TTLs mean slower token revocation. If a user's access should be revoked immediately, a 300-second (or longer) cache creates a window where the user can still access your API. For most applications, this is acceptable; for security-sensitive systems, you might lower the TTL or disable caching entirely and accept the performance trade-off.

The cache is keyed differently depending on the authorizer type. For Lambda authorizers with the TOKEN type, it's keyed by the authentication token itself. For REQUEST type Lambda authorizers, you can specify custom cache key parameters. For Cognito, it's keyed by the access token. This means that if a token is revoked, the cached decision remains valid until the TTL expires—a limitation you should be aware of.

### Error Handling and Security Best Practices

When building authorizers, remember that they're security-critical components. A bug or misconfiguration can open your API to unauthorized access or create unnecessary friction for legitimate users.

Always fail securely. If your authorizer encounters an error—perhaps an external service is down or a token is malformed—it should deny the request. Returning an Allow policy due to an error is a serious security vulnerability. Log errors thoroughly (without exposing sensitive information like tokens) so you can diagnose issues, but err on the side of denying access when in doubt.

For Lambda authorizers, be mindful of execution time. If your authorizer is slow, every API request pays that latency cost. Minimize external calls, use connection pooling, and consider caching token validation results at the authorizer level (separate from API Gateway's caching).

Protect sensitive data. If your authorizer calls out to an authentication service, use environment variables or AWS Secrets Manager to store credentials, never hardcode them. When returning context variables, be careful not to leak sensitive information like passwords or internal system details.

Monitor your authorizers. Set up CloudWatch alarms for authorizer execution duration, error rates, and throttling. A misbehaving authorizer can silently degrade your API's performance, so visibility is essential.

### Conclusion

API Gateway's authorizer options span a spectrum from simple access control (API Keys) to sophisticated, flexible authorization logic (Lambda authorizers). Each has its place in the AWS ecosystem. Cognito User Pool authorizers are perfect for managed identity and user authentication. IAM authorizers excel at internal, AWS-native security. Lambda authorizers offer maximum flexibility for custom scenarios.

The best choice depends on your application's identity model, your users, and your operational constraints. Many production systems benefit from layering multiple mechanisms—using API Keys for basic access control, Cognito or IAM for identity, and Lambda authorizers for complex business logic.

As you design your APIs, think carefully about your authorization strategy early. It's far easier to implement the right mechanism from the start than to retrofit it later. And remember that authorizers are only one piece of your security puzzle; defense in depth—validating input, encrypting data in transit and at rest, monitoring logs—is essential for a truly secure API.
