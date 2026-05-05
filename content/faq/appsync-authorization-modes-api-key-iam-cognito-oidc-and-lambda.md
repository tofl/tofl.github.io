---
title: "AppSync Authorization Modes: API Key, IAM, Cognito, OIDC, and Lambda"
---

## AppSync Authorization Modes: API Key, IAM, Cognito, OIDC, and Lambda

Securing your GraphQL APIs is one of the most critical decisions you'll make when building serverless applications on AWS. AppSync, AWS's fully managed GraphQL service, doesn't leave you with a one-size-fits-all approach. Instead, it offers five distinct authorization modes, each designed for different use cases and security postures. Whether you're building a public-facing application, enabling service-to-service communication, or integrating with third-party identity providers, AppSync has a mode built for your scenario.

Understanding these modes—and knowing when to apply each one—is essential for building secure, scalable applications. More than that, it's a skill that translates directly into real-world architecture decisions and interview discussions about API security.

### Why Authorization Modes Matter in AppSync

Before diving into the specific modes, let's establish why this matters. GraphQL APIs expose the same attack surface as REST APIs, but with additional complexity because a single query can access multiple resources. Without proper authorization, you might inadvertently expose sensitive data or allow unauthorized mutations.

AppSync's approach is elegant: rather than forcing you to write authorization logic inside resolvers, you can declaratively specify authorization rules at the schema level. This separation of concerns means your business logic stays clean, your security rules are auditable and consistent, and you can change authorization policies without touching resolver code.

The five modes are designed to work independently or in combination. A single AppSync API can enforce different authorization rules for different operations, using different modes simultaneously. This flexibility is what makes AppSync powerful for real-world applications.

### API Key Authorization: Public and Development Access

API Key mode is the simplest authorization mode AppSync offers. It's not meant for production security—think of it as a mechanism for public read-only data or rapid development and testing.

When you create an AppSync API through the console, API Key mode is often enabled by default with a default expiration of seven days. The key is passed in the `x-api-key` HTTP header, and any request bearing a valid key is automatically authorized.

API Key authorization works best when:

You're building a public API where anyone should be able to read certain data without authentication. Imagine a weather service API that exposes current conditions freely to all consumers. An API Key ensures you can track usage and revoke access if needed, but doesn't create friction for legitimate users.

You're in early-stage development and want quick feedback loops. Rather than setting up Cognito User Pools or IAM roles immediately, you can prototype your API with API Key mode and migrate to stronger security later.

You need a fallback authorization mode for backwards compatibility or specific low-risk operations.

Here's what a schema using API Key authorization might look like:

```graphql
type Query {
  getPublicArticle(id: ID!): Article
    @auth(rules: [{ allow: public }])
}

type Article {
  id: ID!
  title: String!
  content: String!
  author: String!
}
```

With this schema, the `getPublicArticle` query requires only a valid API Key to execute. The `@auth` directive with `allow: public` translates to API Key mode in AppSync.

In practice, this means your client-side code would include the API Key in every request:

```javascript
const client = new AWSAppSyncClient({
  url: 'https://your-api.appsync-api.region.amazonaws.com/graphql',
  region: 'us-east-1',
  auth: {
    type: AUTH_TYPE.API_KEY,
    apiKey: 'your-api-key-here',
  },
});
```

A critical point: API Keys are transmitted in headers and can be exposed in client-side code. Never use API Key mode for sensitive operations. If someone extracts your API Key from a browser console or mobile app, they have the same access level as you. Rotation is simple—generate a new key and update your client configuration—but the window of vulnerability still exists.

### IAM Authorization: Service-to-Service and AWS Identity

IAM (Identity and Access Management) authorization mode ties directly into AWS's identity system. Instead of managing separate credentials for GraphQL access, you use IAM roles and policies. This mode excels when your AppSync API is consumed by other AWS services or applications running within AWS infrastructure.

Consider a microservices architecture where a Lambda function needs to query your AppSync API. Rather than storing an API Key as a secret and managing its rotation, you can grant the Lambda's execution role permissions to invoke AppSync. The AWS SDK handles credential management transparently, rotating temporary credentials automatically behind the scenes.

IAM authorization is ideal for:

Service-to-service communication where both services run in AWS. A Lambda function in your application needs to call AppSync. An ECS task performing batch processing needs GraphQL access. A Step Functions workflow orchestrates operations that depend on AppSync queries and mutations.

Workloads running on EC2 instances, ECS, or Lambda where you want to leverage IAM roles instead of managing API credentials.

Applications built with AWS Amplify that use Cognito identity pools. Cognito can vend temporary AWS credentials, allowing users to authenticate and then make IAM-authorized AppSync calls.

To configure IAM authorization, you'd define a policy granting the necessary AppSync permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "appsync:GraphQL"
      ],
      "Resource": [
        "arn:aws:appsync:region:account-id:apis/api-id/*"
      ]
    }
  ]
}
```

Attach this policy to the IAM role of the service that needs to access AppSync. Then, when calling AppSync from code running under that role, you can let the AWS SDK handle authentication automatically:

```python
import boto3
from aws_lambda_powertools import Logger

logger = Logger()
appsync_client = boto3.client('appsync')

def lambda_handler(event, context):
    query = """
      query GetUserData($id: ID!) {
        getUser(id: $id) {
          id
          name
          email
        }
      }
    """
    
    # The boto3 client handles IAM signing transparently
    response = requests.post(
        'https://your-api.appsync-api.region.amazonaws.com/graphql',
        json={'query': query, 'variables': {'id': event['userId']}},
        headers={'Authorization': aws_sigv4_signed_headers()}
    )
    
    return response.json()
```

In practice, many developers use higher-level libraries that handle SigV4 signing automatically, so you don't need to manually construct headers.

The beauty of IAM authorization is that it leverages existing AWS identity infrastructure. If you're already using IAM for EC2, Lambda, and other services, extending it to AppSync requires no new credential management paradigms.

### Amazon Cognito User Pools: Authenticated End Users

Cognito User Pools provide a managed authentication service that handles user sign-up, sign-in, and profile management. When you integrate AppSync with Cognito User Pools, authenticated users receive JWT tokens that serve as proof of identity. AppSync validates these tokens and extracts user claims to enforce authorization rules.

This mode is the go-to choice for consumer-facing applications, mobile apps, and any scenario where you need traditional user authentication. Unlike API Keys, which are static and can't represent individual users, Cognito tokens contain rich claims about who the user is and can expire on a schedule you control.

Cognito User Pools authorization works best for:

Mobile and web applications where users sign up and log in through a standard authentication flow. Your app collects credentials, exchanges them for tokens via Cognito, and includes the token in AppSync requests.

Multi-tenant applications where operations should be scoped to specific users. You can define authorization rules that ensure users can only read their own data or data shared explicitly with them.

Applications that need fine-grained control over user permissions and user groups. Cognito supports group membership, custom attributes, and role-based access control.

Here's a schema example with Cognito User Pools authorization:

```graphql
type Query {
  getMyProfile: User
    @auth(rules: [{ allow: owner, provider: userPools }])
  
  listUsers: [User]
    @auth(rules: [{ allow: groups, groups: ["Admin"], provider: userPools }])
}

type User {
  id: ID!
  email: String!
  name: String!
  profile: String
}

type Mutation {
  updateMyProfile(name: String!): User
    @auth(rules: [{ allow: owner, provider: userPools }])
}
```

In this schema, `getMyProfile` and `updateMyProfile` are restricted to the authenticated owner of the user record. The `listUsers` query is available only to users in the "Admin" group. The `owner` keyword is a special directive feature that automatically restricts access based on a field that stores the user's identity, typically the `id` field.

On the client side, authenticating with Cognito User Pools looks like this:

```javascript
import { Auth } from 'aws-amplify';
import { AWSAppSyncClient, AUTH_TYPE } from 'aws-amplify';

// Sign up or sign in
const user = await Auth.signIn(username, password);

// Get the ID token
const currentSession = await Auth.currentSession();
const idToken = currentSession.getIdToken().getJwtToken();

// Configure AppSync client
const client = new AWSAppSyncClient({
  url: 'https://your-api.appsync-api.region.amazonaws.com/graphql',
  region: 'us-east-1',
  auth: {
    type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
    jwtToken: idToken,
  },
});
```

Cognito tokens are JWTs and include claims about the user. AppSync extracts these claims and makes them available to your resolvers through the `$identity` context variable. For instance, `$identity.sub` gives you the unique user ID, and `$identity.claims` contains custom attributes and group memberships.

This brings us to a powerful pattern: you can use Cognito's `owner` concept in your schema. When you mark a field with `@auth(rules: [{ allow: owner }])`, AppSync expects a field on that type (usually `owner`) that stores the user ID. Queries and mutations are then restricted to the user who owns the resource.

```graphql
type Post {
  id: ID!
  title: String!
  content: String!
  owner: String
    @auth(rules: [{ allow: owner, provider: userPools, operations: [read, update, delete] }])
}
```

Here, only the user who created the post (stored in the `owner` field) can read, update, or delete it.

### OpenID Connect (OIDC): Third-Party Identity Providers

If your users authenticate through external identity providers—whether that's Auth0, Okta, a corporate identity system, or any OIDC-compliant provider—you can configure AppSync to trust their tokens directly. OIDC mode validates tokens issued by these providers and extracts claims just as it does with Cognito.

OIDC is particularly valuable in enterprise environments where identity is centralized in systems like Okta or Azure AD, or in scenarios where you want to offer authentication through multiple providers without managing all of them directly.

OIDC authorization excels when:

Your organization uses a corporate identity provider like Okta or Azure AD, and you want to extend that identity system to GraphQL APIs without replicating user management in Cognito.

You're building a B2B application and want to accept tokens from your customers' identity providers.

You're migrating from a legacy authentication system to AWS but need to maintain compatibility with existing identity infrastructure.

You're offering multiple authentication options and want to reduce vendor lock-in to AWS Cognito.

Configuring OIDC in AppSync requires you to specify the provider's configuration URL. AppSync periodically fetches the provider's public keys from that URL to validate incoming tokens:

```graphql
type Query {
  getProfile: User
    @auth(rules: [{ allow: owner, provider: oidc }])
}

type User {
  id: ID!
  email: String!
  name: String!
  sub: String
}
```

In your AppSync configuration, you'd specify the OIDC provider:

```
OIDC Authority: https://your-oidc-provider.com
OIDC Client ID: your-client-id (optional, depending on provider)
```

On the client side, the flow differs slightly because the token comes from your OIDC provider, not from AWS:

```javascript
const client = new AWSAppSyncClient({
  url: 'https://your-api.appsync-api.region.amazonaws.com/graphql',
  region: 'us-east-1',
  auth: {
    type: AUTH_TYPE.OPENID_CONNECT,
    jwtToken: tokenFromOIDCProvider,
  },
});
```

The key difference between Cognito User Pools and OIDC is operational: with Cognito, AWS manages the identity provider infrastructure. With OIDC, you (or your organization) operate the identity provider, and AppSync simply validates tokens it receives.

### Lambda Authorization: Custom Authorization Logic

The final authorization mode—Lambda—is for scenarios where none of the built-in modes fit your needs. Instead of AppSync making authorization decisions directly, it invokes a Lambda function with the GraphQL request details, and that function returns an authorization decision.

Lambda authorization is a power tool for:

Complex, business-logic-dependent authorization rules that don't fit neat role-based or owner-based patterns. Imagine you're selling access to datasets, and a user's authorization depends on their subscription tier, the current date, and whether they've exceeded their monthly quota. A Lambda function can evaluate all these factors and return a decision.

Hybrid authentication scenarios where you integrate multiple identity systems or need to consult external services before authorizing a request.

Rate limiting or quota enforcement. The Lambda function can check how many requests a user has made and deny authorization if they've exceeded limits.

Attribute-based access control where authorization depends on fine-grained attributes of the user, resource, and context.

Here's what a Lambda authorizer function might look like:

```python
import json
import boto3

dynamodb = boto3.resource('dynamodb')
users_table = dynamodb.Table('Users')

def lambda_handler(event, context):
    """
    Evaluate custom authorization logic.
    
    The event contains:
    - authorizationToken: The token passed by the client
    - requestContext: Details about the GraphQL request
    """
    
    token = event.get('authorizationToken')
    request_context = event.get('requestContext', {})
    
    # Example: validate token and extract user info
    try:
        user_id = validate_token(token)
    except Exception as e:
        return deny_authorization(f"Invalid token: {str(e)}")
    
    # Example: check user subscription level
    user = users_table.get_item(Key={'id': user_id})['Item']
    
    if user['subscription_tier'] == 'free' and is_premium_operation(request_context):
        return deny_authorization("Upgrade required for this operation")
    
    if user['subscription_expired']:
        return deny_authorization("Subscription expired")
    
    # Authorization granted
    return allow_authorization(user_id, user)

def allow_authorization(user_id, user):
    return {
        'principalId': user_id,
        'resolverContext': {
            'userId': user_id,
            'tier': user.get('subscription_tier'),
            'email': user.get('email'),
        }
    }

def deny_authorization(reason):
    raise Exception(f"Unauthorized: {reason}")

def validate_token(token):
    # Your custom token validation logic
    pass

def is_premium_operation(request_context):
    # Determine if the requested operation requires a premium subscription
    pass
```

In your schema, you'd mark operations as requiring Lambda authorization:

```graphql
type Query {
  listDatasets: [Dataset]
    @auth(rules: [{ allow: custom, provider: function }])
}

type Dataset {
  id: ID!
  name: String!
  rows: Int!
  owner: String!
}
```

The `@auth(rules: [{ allow: custom, provider: function }])` directive tells AppSync to invoke a Lambda authorizer for this query. The Lambda function's response is captured in the resolver context, and you can access the resolved context in your resolvers.

Lambda authorization offers maximum flexibility, but it comes with trade-offs. Each GraphQL request triggers a Lambda invocation, which adds latency. Lambda cold starts, though typically quick, can impact request times. Additionally, managing authorization logic in Lambda code means it's not centrally visible in your schema the way other modes are. For these reasons, Lambda authorization is best reserved for genuinely complex scenarios that can't be handled by the declarative modes.

### Combining Multiple Authorization Modes

One of AppSync's most powerful features is the ability to combine multiple authorization modes on the same API. Different operations can use different modes, and you can even specify fallback modes.

Imagine a public blog platform. Some queries, like listing published articles, should be accessible via API Key (public access). Authenticated users should be able to create and edit their own posts using Cognito User Pools. Administrators might use IAM roles. All of these can coexist on the same API:

```graphql
type Query {
  listPublishedArticles: [Article]
    @auth(rules: [{ allow: public }])
  
  getMyArticles: [Article]
    @auth(rules: [{ allow: owner, provider: userPools }])
  
  listAllArticles: [Article]
    @auth(rules: [{ allow: groups, groups: ["Admin"], provider: userPools }])
}

type Mutation {
  createArticle(title: String!, content: String!): Article
    @auth(rules: [{ allow: owner, provider: userPools }])
  
  deleteArticle(id: ID!): Article
    @auth(rules: [
      { allow: owner, provider: userPools },
      { allow: groups, groups: ["Admin"], provider: userPools }
    ])
  
  adminResetData: String
    @auth(rules: [{ allow: groups, groups: ["Admin"], provider: userPools }])
}

type Article {
  id: ID!
  title: String!
  content: String!
  owner: String!
  published: Boolean!
}
```

In this schema, `listPublishedArticles` requires only an API Key. `getMyArticles` requires Cognito authentication and restricts results to articles owned by the authenticated user. `createArticle` requires Cognito authentication. `deleteArticle` allows both the owner and administrators (members of the "Admin" group) to delete.

When you have multiple authorization rules on an operation, AppSync evaluates them in order and grants access if any rule allows it. This is an "allow if any match" pattern, sometimes called OR logic.

### Understanding the @auth Directive and Amplify Integration

If you're using AWS Amplify to build your frontend, you interact with AppSync authorization through the `@auth` directive. Amplify's GraphQL Code Generator and Amplify Studio help generate schema with authorization rules, but understanding what those rules actually translate to in AppSync is essential.

The `@auth` directive is not part of the GraphQL specification—it's an Amplify-specific extension that gets translated into AppSync authorization rules when you deploy. Here's the mapping:

The `allow: public` rule maps to API Key authorization in AppSync. Any request with a valid API Key passes.

The `allow: private` rule with a Cognito User Pools provider maps to authenticated user access. Any user with a valid Cognito token can access the operation.

The `allow: owner` rule maps to owner-based access. The operation is restricted to the user whose ID matches the resource's owner field.

The `allow: groups` rule with a Cognito User Pools provider maps to group-based access. Only users in the specified groups can access the operation.

The `allow: custom` rule maps to Lambda authorization. A custom Lambda function evaluates the authorization decision.

When you deploy a schema through Amplify, the CLI translates these directives into AppSync authorization rules behind the scenes. This abstraction is helpful for rapid development, but when debugging authorization issues, you need to understand what's happening in AppSync directly.

For instance, this Amplify schema:

```graphql
type Post @model @auth(
  rules: [
    { allow: public, operations: [read] },
    { allow: owner, provider: userPools }
  ]
) {
  id: ID!
  title: String!
  content: String!
  owner: String!
}
```

translates to AppSync rules where reading a Post requires API Key authorization, while creating, updating, or deleting requires Cognito authentication and ownership of the record.

### Authorization Context and Resolver Access

Regardless of which authorization mode you use, once authorization succeeds, your resolvers have access to details about the authorization context. This is crucial because your business logic often needs to know who is making the request.

The `$identity` context variable in AppSync resolvers contains:

For API Key authorization, minimal information—essentially just that a valid key was provided.

For IAM authorization, the IAM principal (role or user), account ID, and ARN.

For Cognito User Pools, the user's unique identifier (sub), username, email, groups, and any custom attributes.

For OIDC, the claims embedded in the token, which varies based on the provider's token structure.

For Lambda authorization, whatever the Lambda function returns in the `resolverContext` field.

In practice, you'll use these values in your resolvers to implement data filtering or to populate audit fields. For example:

```json
{
  "version": "2018-05-29",
  "operation": "Query",
  "query": {
    "expression": "attribute_exists(#owner) AND #owner = :user_id",
    "expressionNames": {
      "#owner": "owner"
    },
    "expressionValues": {
      ":user_id": "$identity.sub"
    }
  }
}
```

This resolver filter (written in VTL, AppSync's templating language) ensures that only the user who owns the record can read it. The `$identity.sub` variable—the Cognito user's unique ID—is compared against the record's owner field.

### Best Practices for Authorization in AppSync

As you design authorization for your AppSync APIs, keep a few principles in mind.

First, match the authorization mode to your use case. API Key is simple and fast, but insecure. Cognito User Pools is mature and feature-rich for consumer applications. IAM is excellent for AWS-to-AWS communication. OIDC fits enterprise scenarios. Lambda is powerful but should be reserved for genuinely complex logic.

Second, use the declarative `@auth` directives in your schema rather than implementing authorization logic in resolvers. This keeps your authorization rules visible, auditable, and easier to maintain. If you start scattering authorization checks throughout your resolver code, you'll end up with inconsistencies and security gaps.

Third, be explicit about operations. Don't just mark an entire type with a single authorization rule. Different operations may need different rules. A type might be readable by many but writable only by the owner. The schema examples in this article show this principle in action.

Fourth, test authorization thoroughly. Write tests that verify unauthorized users can't access protected operations, that authorized users can, and that edge cases (expired tokens, missing claims, invalid signatures) are handled correctly.

Fifth, if you use owner-based access, ensure that the field storing the owner is properly set when records are created. It's common to use a resolver that automatically populates the owner field from `$identity.sub`:

```json
{
  "version": "2018-05-29",
  "operation": "PutItem",
  "key": {
    "id": { "S": "$util.autoId()" }
  },
  "attributeValues": {
    "title": { "S": "$input.get('title')" },
    "owner": { "S": "$identity.sub" },
    "createdAt": { "S": "$util.time.nowISO8601()" }
  }
}
```

This ensures that when a user creates a post, their ID is automatically recorded as the owner, and future authorization checks will work correctly.

### Conclusion

AppSync's authorization modes reflect the diversity of real-world application scenarios. Whether you're building a public API, enabling service-to-service communication, authenticating end users, integrating enterprise identity systems, or implementing custom authorization logic, AppSync has a mode designed for that purpose.

The true power emerges when you combine these modes thoughtfully, declaring your authorization rules in your schema where they're visible and maintainable, and leveraging the identity context in your resolvers to implement data filtering and auditing. Understanding each mode's strengths and trade-offs—and knowing when to choose one over another—is a mark of an experienced API developer.

As you build on AppSync, start with the simplest authorization mode that meets your needs, and add complexity only when genuinely required. A clear, well-documented authorization strategy is far more valuable than a complex one that nobody understands three months later.
