---
title: "Securing AppSync APIs: Comparing API Key, IAM, Cognito, OIDC, and Lambda Authorization"
---

## Securing AppSync APIs: Comparing API Key, IAM, Cognito, OIDC, and Lambda Authorization

Building a GraphQL API on AWS AppSync means making critical decisions about who can access what. Unlike traditional REST APIs where authorization often feels like an afterthought, AppSync bakes authorization directly into its schema through a powerful directive system. Whether you're building a public-facing API with selective authenticated features, a enterprise application relying on existing identity providers, or a backend service orchestrating calls between AWS resources, AppSync's five authorization modes—API Key, IAM, Amazon Cognito, OpenID Connect (OIDC), and Lambda—offer flexible patterns to meet virtually any security requirement.

Understanding how to layer these authorization modes, inspect identity context in resolvers, and design schemas that gracefully handle both public and authenticated access is essential for building secure, scalable GraphQL APIs on AWS. This article walks through each mode in depth, shows you how to combine them on a single API, and demonstrates the concrete patterns you'll encounter in production systems.

### Understanding AppSync Authorization Fundamentals

Before diving into the five modes, let's establish the conceptual foundation. AppSync authorization operates at two levels: the *schema level* through GraphQL directives, and the *resolver level* through the request context object. The schema directives control *whether* a request can reach a field at all, while the resolver context allows you to implement fine-grained, business-logic-driven authorization decisions within the field's logic.

When a request arrives at AppSync, the service evaluates the authorization directive attached to the field being queried. If authorization fails, the request is rejected before the resolver even executes. If it succeeds, the resolver receives a context object—`$ctx` in AppSync resolver mapping templates—that contains identity information extracted from the authorization mode that processed the request. This two-stage approach keeps your authorization logic declarative and enforceable at the schema boundary while still allowing rich context-aware decisions inside resolvers.

The `$ctx.identity` object is the bridge between authorization and your business logic. Its structure and contents vary depending which authorization mode authenticated the request, but it consistently provides identity claims, group memberships, and other metadata that resolvers can use to make fine-grained decisions. Mastering how to read and apply this context is what separates a secure API from one that merely appears secure on the surface.

### The Five Authorization Modes and Their Use Cases

AppSync offers five distinct authorization modes, each with different trust models, token lifetimes, and operational characteristics. Rather than thinking of them as competing options, think of them as tools designed for different contexts. A production API typically uses multiple modes simultaneously on different fields or against different resources.

#### API Key Authorization

The API Key mode is AppSync's simplest authorization mechanism. It uses a long-lived API key that you create in the AWS Management Console or via the CLI. This key is included in requests (typically in the `X-API-Key` header for REST calls or in the GraphQL `Authorization` header) and AppSync validates it against the configured key for your API.

API Key authorization is stateless, doesn't involve any token validation or expiration checks beyond key existence, and imposes no external service dependencies. This makes it extremely fast and suitable for high-volume, low-sensitivity scenarios. However, API Keys are inherently difficult to rotate, offer no user identity differentiation—every request authenticated with the same key appears identical to AppSync—and are generally considered less secure than other modes.

The typical use case for API Key authorization is public development environments, test harnesses, and mobile applications that need basic protection against random internet traffic but don't require per-user tracking. You might also use API Key authorization for a public query field that should be accessible to anyone but needs minimal security. For example, a weather API, public product catalog, or demo endpoint.

When a request is authenticated via API Key, `$ctx.identity` contains minimal information: primarily just the fact that authorization succeeded. You cannot differentiate between different callers, and you shouldn't rely on API Key-authenticated requests for sensitive operations.

#### IAM Authorization

IAM (Identity and Access Management) authorization leverages AWS's native identity system. When a caller signs requests with AWS credentials—either temporary credentials from STS or long-lived access keys—AppSync validates the signature and cross-references it against IAM policies attached to the calling principal (user, role, or service).

This mode requires callers to possess valid AWS credentials and integrates seamlessly with AWS's permission model. It's the natural choice for backend-to-backend communication where both services run within AWS, for mobile applications using AWS Amplify with Cognito-federated temporary credentials, and for any scenario where you want to leverage existing IAM policies.

IAM authorization is highly secure because credentials are cryptographically signed, can be scoped to specific actions and resources, and can be revoked or rotated through standard AWS procedures. The downside is operational complexity—callers must manage AWS credentials, and you often need to design IAM policies carefully to avoid overly broad permissions.

When AppSync processes an IAM-authenticated request, `$ctx.identity` is enriched with the AWS Account ID, the ARN of the calling principal, and any additional metadata from the STS session (such as tags). This allows you to write resolvers that make authorization decisions based on the caller's AWS identity.

#### Amazon Cognito User Pools Authorization

Cognito User Pools is AWS's managed user directory and authentication service. Users sign up, create passwords, enable multi-factor authentication, and authenticate to obtain JWT tokens. These tokens are then included in AppSync requests, and AppSync validates the token signature, expiration, and claims.

Cognito User Pools is the go-to choice when you want a managed, user-facing authentication system. It handles user registration, password policies, session management, and token issuance, reducing the operational burden on your team. It's ideal for web applications, mobile apps with user accounts, and any consumer-facing system that needs self-service authentication.

The JWT tokens that Cognito issues include rich claim data: the user's sub (subject, equivalent to a unique user ID), username, email, email verification status, groups (if you've organized users into groups for coarse-grained authorization), and any custom attributes you've defined in your user pool. When AppSync validates and accepts a Cognito token, all this information becomes available in `$ctx.identity.claims`, enabling detailed authorization decisions based on user attributes.

#### OpenID Connect (OIDC) Authorization

OIDC is an open standard for decentralized identity. Instead of maintaining your own user directory, you delegate authentication to an external identity provider—perhaps Auth0, Okta, Azure AD, or another OIDC-compliant service. The external provider issues JWT tokens that AppSync validates by fetching and caching the provider's public key.

OIDC is valuable when you want to integrate with enterprise identity providers, reduce the operational burden of managing users, or when your organization already uses a third-party identity platform. It's also useful if you want to offer "social login" options without managing social provider integrations yourself.

The token claims available in `$ctx.identity` depend on what your OIDC provider includes in the JWT, but typically include a unique subject identifier, email, name, and any custom claims the provider supports.

#### Lambda Authorization

Lambda authorization invokes a Lambda function to make the authorization decision. The function receives the incoming request, token, or other authorization context and responds with an authorization decision plus optional context data. This gives you maximum flexibility: you can implement custom authorization logic, integrate with proprietary systems, validate tokens against external services, enforce time-based access, or implement complex rule engines.

Lambda authorization is conceptually powerful but operationally expensive—every request incurs a Lambda invocation, which adds latency and cost. It's best used when your authorization logic doesn't fit neatly into other modes or when you're integrating with external authorization systems like policy decision points or third-party API gateways.

When using Lambda authorization, you control what gets returned to `$ctx.identity`. The Lambda function can attach any claims or context data you define, giving you complete control over what information resolvers see.

### Directive Syntax and Schema-Level Authorization

In AppSync, you declare authorization requirements directly in your GraphQL schema using directives. The five directives corresponding to our five modes are `@aws_api_key`, `@aws_iam`, `@aws_cognito_user_pools`, `@aws_oidc`, and `@aws_lambda`. The `@aws_auth` directive is a shorthand that applies the API's default authorization mode.

Directives can be applied at the schema level (affecting the entire API), the type level (affecting all fields of that type), or the field level (affecting individual fields). Field-level directives give you the finest control and are the most flexible for mixed-authorization APIs.

Here's a simple schema that demonstrates field-level authorization directives:

```graphql
type Query {
  publicPosts: [Post!]! @aws_api_key
  myProfile: User! @aws_cognito_user_pools
  adminDashboard: AdminData! @aws_iam
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User! @aws_cognito_user_pools
}

type User {
  id: ID!
  email: String!
  profile: UserProfile @aws_cognito_user_pools
}
```

In this schema, `publicPosts` is available to anyone with a valid API key—perfect for a public query that doesn't require authentication. The `myProfile` query requires Cognito authentication because it's a user-specific resource. The `adminDashboard` query requires IAM authentication, presumably because only backend services or specific AWS principals should access it. The `author` field on `Post` requires Cognito authentication, so only logged-in users can see who wrote a post (a common privacy pattern).

When you apply a directive to a field, AppSync validates the authorization *before* the field's resolver executes. If authorization fails, the field returns `null` (in non-required fields) or an error (in required fields), and the resolver never runs. This ensures that sensitive logic remains protected by the schema itself, not just by developer discipline inside resolvers.

### Combining Multiple Authorization Modes on a Single API

Real-world APIs rarely use a single authorization mode. Instead, they layer multiple modes to serve different audiences and use cases. AppSync supports declaring multiple authorization directives on the same field, creating a union of authorized access patterns: a request succeeds if it satisfies *any* of the directives.

Consider this common pattern:

```graphql
type Query {
  post(id: ID!): Post @aws_api_key @aws_cognito_user_pools
  userProfile: User! @aws_cognito_user_pools
  systemStatus: SystemInfo! @aws_iam
}

type Mutation {
  createPost(input: CreatePostInput!): Post! @aws_cognito_user_pools
  deletePost(id: ID!): Boolean! @aws_iam
  updateSystemConfig(config: JSON!): SystemConfig! @aws_iam @aws_lambda
}
```

Here, `post` accepts either an API Key (perhaps a public preview of recent posts) or Cognito authentication (for logged-in users to access any post). The `userProfile` is locked to Cognito-authenticated users only. The `systemStatus` is accessible to AWS services via IAM. The `deletePost` mutation requires IAM, while `updateSystemConfig` accepts IAM *or* a Lambda authorization function, allowing you to implement custom logic that might grant access based on external rules.

When multiple directives are present, AppSync evaluates them in order and succeeds if any directive authorizes the request. The order of directives doesn't affect the outcome—it's a logical OR, not an AND. The `$ctx.identity` object reflects whichever directive authorized the request; if the request was authorized via Cognito, you'll see Cognito-specific claims; if via IAM, you'll see AWS identity metadata.

### Understanding Request Flow and Identity Context

The request flow through AppSync varies slightly depending on which authorization mode is active, but the general pattern is consistent. Let's trace a request through the system to understand what happens at each stage.

When a client sends a GraphQL query to AppSync, the first thing that happens is *authorization routing*. AppSync examines the request and determines which authorization mode should handle it. For API Key requests, it checks for the presence of a valid API Key. For IAM requests, it checks for AWS Signature Version 4 headers. For Cognito, it looks for a JWT token in the authorization header. For OIDC, it also looks for a JWT token and validates it against the configured OIDC provider's keys. For Lambda, it invokes the configured Lambda function with the request.

If the chosen authorization mode succeeds, AppSync continues to resolver execution. As it processes each GraphQL field, it evaluates any authorization directives attached to that field. If the request satisfies the directive, the resolver executes. If not, the field is omitted or returns an error.

Throughout this process, AppSync populates `$ctx.identity` with information about the authenticated principal. The exact contents depend on the authorization mode:

For **API Key**, `$ctx.identity` is minimal and contains only the fact that a valid key was provided. There's no user-level information.

For **IAM**, `$ctx.identity` contains:
- `accountId`: The AWS Account where the caller's principal is defined
- `cognitoIdentityAuthProvider`: Empty for IAM-authenticated requests
- `cognitoIdentityAuthType`: Empty
- `cognitoIdentityId`: Empty
- `sourceIp`: The caller's IP address
- `username`: The IAM role or user name
- `userArn`: The full ARN of the calling principal
- `accountArn`: The ARN of the AWS Account (format: `arn:aws:iam::ACCOUNT_ID:root`)

For **Cognito User Pools**, `$ctx.identity` contains:
- `accountId`: The AWS Account where the User Pool is defined
- `claims`: A map of all JWT claims, typically including `sub` (user ID), `email`, `email_verified`, `cognito:groups` (list of groups the user belongs to), and any custom attributes
- `cognito_groups`: A convenience list of group names the user belongs to
- `defaultAuthStrategy`: The authentication strategy used
- `issuer`: The User Pool's issuer URL
- `sourceIp`: The caller's IP address
- `sub`: The user's unique subject (user ID)
- `username`: The Cognito username

For **OIDC**, `$ctx.identity` contains similar claims to Cognito, with the exact structure depending on what your OIDC provider includes in the JWT. At minimum, you'll have `claims` containing the JWT payload and `sub` containing the user's unique identifier.

For **Lambda**, `$ctx.identity` contains exactly what your Lambda function returns. You have complete control over its structure, allowing you to enrich identity context with data from external systems or to implement custom authorization rules.

Understanding these subtle differences is crucial for writing correct resolver logic. A resolver that tries to access `$ctx.identity.cognito_groups` will fail if the request was authorized via IAM, because that field only exists for Cognito-authenticated requests. Best practice is to check the source of the authorization context before accessing specific fields, or to normalize the context in a Lambda function before AppSync sees it.

### Fine-Grained Authorization in Resolvers Using Identity Context

Schema-level directives provide a coarse authorization gate: you're either allowed to access a field or you're not. But real applications often need finer control. You might want to show a user their own profile but not others' profiles. You might want to allow users to view posts but only to edit posts they authored. This is where resolver-level authorization using the identity context comes in.

Consider a resolver for a user profile query:

```python
import json

def handler(event, context):
    user_id = event['arguments']['userId']
    requesting_user = event['identity']['sub']
    
    # User can only view their own profile
    if user_id != requesting_user:
        return {
            'errorMessage': 'Unauthorized: cannot view other users profiles'
        }
    
    # Fetch from database
    return {
        'id': user_id,
        'email': 'user@example.com',
        'createdAt': '2023-01-15'
    }
```

This resolver checks whether the user ID being requested matches the authenticated user's `sub` claim. Only if they match does the resolver proceed to fetch data. This pattern—checking user identity against a resource owner field—is fundamental to most authorization logic.

Here's a more complex example using Cognito groups. Suppose your Cognito User Pool organizes users into groups like `admin`, `editor`, and `viewer`. Different groups should have different permissions:

```python
def handler(event, context):
    groups = event['identity'].get('cognito:groups', [])
    action = event['arguments']['action']
    
    if action == 'delete' and 'admin' not in groups:
        return {
            'errorMessage': 'Only admins can delete resources'
        }
    
    if action == 'edit' and 'admin' not in groups and 'editor' not in groups:
        return {
            'errorMessage': 'Only admins and editors can edit resources'
        }
    
    # Proceed with operation
    return {'success': True}
```

This pattern is especially powerful when combined with Cognito's group management features. You can assign users to groups through the AWS Console or API, and those group memberships flow automatically into the JWT token and then into `$ctx.identity`, without requiring any additional logic in your application.

For IAM-authenticated requests, you might authorize based on the caller's role or resource tags:

```python
def handler(event, context):
    caller_arn = event['identity']['userArn']
    
    # Allow specific service roles
    if 'role/LambdaExecutionRole' in caller_arn:
        return process_request(event)
    elif 'role/APIGatewayInvoker' in caller_arn:
        return process_request(event)
    else:
        return {
            'errorMessage': 'Caller role not authorized'
        }
```

The key principle is that you're implementing business logic authorization—rules specific to your application—while the schema directives provide the authentication foundation. Never trust that a request reached your resolver; always validate authorization again, because attack surface includes not just the public internet but also your internal systems and any code that might accidentally call resolvers.

### Designing Public + Authenticated APIs

A common real-world pattern is an API that exposes certain data publicly but requires authentication for user-specific or sensitive operations. Think of a social media platform where posts are public but creating posts requires authentication, or a news site where articles are free but subscriptions require user accounts.

Here's a schema that demonstrates this pattern:

```graphql
type Query {
  # Public queries
  posts(limit: Int!): [Post!]! @aws_api_key
  post(id: ID!): Post @aws_api_key
  authors(limit: Int!): [Author!]! @aws_api_key
  
  # Authenticated queries
  myFeed: [Post!]! @aws_cognito_user_pools
  bookmarkedPosts: [Post!]! @aws_cognito_user_pools
  myProfile: User! @aws_cognito_user_pools
}

type Mutation {
  # Authenticated mutations
  createPost(input: CreatePostInput!): Post! @aws_cognito_user_pools
  updateProfile(input: UpdateProfileInput!): User! @aws_cognito_user_pools
  bookmarkPost(postId: ID!): Bookmark! @aws_cognito_user_pools
  
  # Admin mutations
  deletePost(id: ID!): Boolean! @aws_iam
  suspendUser(userId: ID!): User! @aws_iam
}

type Post {
  id: ID!
  title: String!
  content: String!
  published: Boolean!
  author: Author!
  # Author details are public
  authorName: String!
  # But author profile is only visible to authenticated users
  authorProfile: Author @aws_cognito_user_pools
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}

type Author {
  id: ID!
  name: String!
  bio: String!
  postCount: Int!
}

type User {
  id: ID!
  username: String!
  email: String!
}
```

This schema uses API Key authorization for public queries about posts and authors. These queries use an API Key because they're safe to expose publicly and don't require user identification. The mutations that modify data require Cognito authentication, ensuring only authenticated users can create posts or modify their profiles. Admin mutations require IAM authorization, restricting them to backend services or administrators with AWS credentials.

Notice that some fields on types are public (like `authorName` on `Post`, which doesn't require authentication) while others are restricted (like `authorProfile`, which requires Cognito authentication). This field-level mixing is powerful: you can expose a public view of a resource but restrict detailed information to authenticated users.

The resolvers for public queries might look like this:

```python
# Resolver for Query.posts
def posts_resolver(event, context):
    limit = event['arguments']['limit']
    
    # Fetch public posts from database
    posts = fetch_public_posts(limit=limit)
    return posts

# Resolver for Query.myProfile
def my_profile_resolver(event, context):
    user_id = event['identity']['sub']
    
    # Fetch authenticated user's profile
    user = fetch_user(user_id)
    return user

# Resolver for Post.authorProfile
def author_profile_resolver(event, context):
    author_id = event['source']['author_id']
    
    # Only return detailed author profile to authenticated users
    # The field-level @aws_cognito_user_pools already ensures
    # this resolver only runs for authenticated requests
    return fetch_author_details(author_id)
```

When an unauthenticated client requests `posts`, they get results. When they request `myProfile`, AppSync returns an authorization error. When an unauthenticated client requests `authorProfile` on a post, that field returns `null` (because it's not required). This graceful degradation is elegant and secure.

### Token Validation Behavior and Expiration

AppSync's token validation behavior differs by authorization mode, and understanding these differences is crucial for building reliable systems.

For **API Key** authorization, AppSync simply checks whether the key exists in its configuration. There's no expiration checking, no revocation mechanism, and no token signature validation. This makes API Key authorization fast but also means that revoking access requires updating the API's configuration, which takes a few seconds to propagate.

For **IAM** authorization, AppSync uses standard AWS Signature Version 4 validation. It checks that the request signature matches the credentials, that the credentials are still valid, and that the caller's IAM policies allow the action. Temporary credentials (the typical case for AWS SDKs) have built-in expiration, and long-lived access keys can be revoked through IAM. The validation is cryptographic and extremely secure.

For **Cognito User Pools**, AppSync validates the JWT token signature using the User Pool's public key (which it caches locally for performance). It also checks the token's `exp` (expiration) claim. If the token is expired, AppSync rejects the request even if the signature is valid. Cognito tokens are typically short-lived—by default, 1 hour—and clients refresh them periodically. AppSync doesn't perform revocation checks (that would require querying Cognito on every request), so a compromised token remains valid until it expires. This is a deliberate tradeoff: better performance for the typical case, at the cost of a brief window of vulnerability if a token is compromised.

For **OIDC**, AppSync similarly validates the JWT signature and checks expiration. It fetches and caches the OIDC provider's public key (typically from the `.well-known/openid-configuration` endpoint) and uses it to verify signatures. The validation behavior mirrors Cognito: signature and expiration checks, but no real-time revocation.

For **Lambda** authorization, AppSync invokes your Lambda function with the request and accepts whatever authorization decision the function returns. If your function decides the request is authorized, AppSync treats it as such. This gives you complete flexibility: you can perform real-time revocation checks, validate against external systems, or implement complex custom logic. The tradeoff is latency—every request incurs a Lambda invocation, which typically adds 50–200ms to request latency.

An important detail: AppSync caches successful OIDC and Cognito authorization decisions for a brief period (typically a few seconds). If the same token arrives in multiple requests, AppSync may skip re-validation and use the cached result. This is a performance optimization but means there's a small window where a revoked token might still be accepted. For most applications, this tradeoff is acceptable; for extremely security-sensitive applications, you might need to disable caching or implement Lambda authorization with real-time checks.

### Practical Schema Design Patterns

Let's look at several real-world schema patterns that combine multiple authorization modes effectively.

**Pattern 1: Public API with Authenticated Features**

```graphql
type Query {
  # Public endpoints
  searchProducts: [Product!]! @aws_api_key
  productDetails(id: ID!): Product @aws_api_key
  
  # User endpoints
  myOrders: [Order!]! @aws_cognito_user_pools
  myWishlist: [Product!]! @aws_cognito_user_pools
  
  # Admin endpoints
  salesReport(dateRange: DateRange!): SalesData! @aws_iam
}

type Mutation {
  # Public
  contactSupport(message: String!): SupportTicket! @aws_api_key
  
  # User
  placeOrder(items: [OrderItem!]!): Order! @aws_cognito_user_pools
  addToWishlist(productId: ID!): Wishlist! @aws_cognito_user_pools
  
  # Admin
  updateInventory(productId: ID!, quantity: Int!): Product! @aws_iam
}
```

This pattern uses API Key for public queries that require minimal protection, Cognito for user-specific operations, and IAM for backend administrative tasks. It's suitable for e-commerce, SaaS platforms, and similar applications.

**Pattern 2: Multi-Tenant with Role-Based Access**

```graphql
type Query {
  # Tenant employees
  employees: [Employee!]! @aws_cognito_user_pools
  
  # Tenant administrators
  tenantConfig: TenantConfig! @aws_cognito_user_pools
  
  # System administrators
  allTenants: [Tenant!]! @aws_iam
}

type Employee {
  id: ID!
  name: String!
  email: String!
  # Sensitive info is only for admins or the employee themselves
  salary: Float @aws_cognito_user_pools
  ssn: String @aws_cognito_user_pools
}
```

The resolver for the `salary` field would then check whether the requesting user is viewing their own record or is an admin:

```python
def salary_resolver(event, context):
    employee_id = event['source']['id']
    requesting_user = event['identity']['sub']
    groups = event['identity'].get('cognito:groups', [])
    
    # Allow if viewing own salary or if user is admin
    if employee_id == requesting_user or 'admin' in groups:
        return event['source'].get('salary')
    
    return None
```

**Pattern 3: Hybrid Public + Service Integration**

```graphql
type Query {
  # Public API
  weatherData(location: String!): WeatherInfo! @aws_api_key
  
  # Service-to-service APIs
  internalWeatherData(location: String!): InternalWeatherInfo! @aws_iam
  
  # User APIs
  myLocationWeather: WeatherInfo! @aws_cognito_user_pools
}
```

Here, the public `weatherData` query returns basic information suitable for public display, while `internalWeatherData` returns more detailed information to authorized AWS services, and `myLocationWeather` personalizes data for authenticated users. The same backend data might power all three, but each endpoint presents a different view with different authorization requirements.

### Lambda Authorization Deep Dive

Lambda authorization deserves special attention because it's the most flexible mode and requires careful implementation.

When you attach Lambda authorization to an AppSync API, AppSync invokes your Lambda function for every request (or, optionally, for every GraphQL operation within a request, depending on the token mode setting). The Lambda function receives the request and must return an authorization decision plus optional context data.

The request to your Lambda function looks like this:

```python
{
    "requestContext": {
        "sourceIp": "203.0.113.42"
    },
    "authorizationToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "type": "TOKEN"  # or "REQUEST" mode
}
```

Your function should respond with:

```python
{
    "principalId": "user123",
    "policyDocument": {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Action": "execute-api:Invoke",
                "Effect": "Allow",
                "Resource": "arn:aws:execute-api:us-east-1:123456789012:graphql/*"
            }
        ]
    },
    "context": {
        "userId": "user123",
        "email": "user@example.com",
        "role": "editor"
    }
}
```

The `principalId` is a unique identifier for the caller. The `policyDocument` uses IAM policy syntax to declare what the caller is allowed to do (this is optional; if omitted, everything is allowed). The `context` object becomes `$ctx.identity` in your resolvers.

Here's a practical Lambda authorization function that validates a JWT token from an external OIDC provider:

```python
import json
import requests
from jose import jwt
from functools import lru_cache

OIDC_PROVIDER = "https://example.auth0.com"
AUDIENCE = "my-appsync-api"

@lru_cache(maxsize=10)
def get_public_key(kid):
    """Fetch and cache OIDC provider's public key"""
    response = requests.get(f"{OIDC_PROVIDER}/.well-known/jwks.json")
    keys = {key['kid']: key for key in response.json()['keys']}
    return keys.get(kid)

def lambda_handler(event, context):
    token = event.get('authorizationToken')
    
    if not token:
        return deny_request('No token provided')
    
    try:
        # Decode token header to find key ID
        unverified = jwt.get_unverified_header(token)
        kid = unverified.get('kid')
        
        if not kid:
            return deny_request('No key ID in token')
        
        # Fetch public key and verify token
        public_key = get_public_key(kid)
        if not public_key:
            return deny_request('Key not found')
        
        claims = jwt.decode(
            token,
            public_key,
            algorithms=['RS256'],
            audience=AUDIENCE
        )
        
        # Authorization successful
        return {
            'principalId': claims['sub'],
            'context': {
                'userId': claims['sub'],
                'email': claims.get('email'),
                'name': claims.get('name'),
                'roles': claims.get('roles', [])
            }
        }
    
    except Exception as e:
        return deny_request(f'Token validation failed: {str(e)}')

def deny_request(reason):
    return {
        'principalId': 'unauthorized',
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [{
                'Action': 'execute-api:Invoke',
                'Effect': 'Deny',
                'Resource': '*'
            }]
        }
    }
```

This function validates a JWT token from an external OIDC provider, caches the provider's public key for performance, and returns the token's claims as the identity context. The caching is important—without it, every request would trigger a network call to fetch the provider's key, adding significant latency.

Lambda authorization is powerful but carries operational costs. Each request incurs a Lambda invocation, which costs money and adds latency. For high-volume APIs, Lambda authorization can become a bottleneck. That said, it's essential when you need:

- Real-time revocation checks against external systems
- Custom authorization logic that depends on external data
- Integration with proprietary security systems
- Complex rule engines or policy decision points

If you use Lambda authorization, consider caching strategies (like the public key caching in the example above) and be prepared to handle the additional latency and cost.

### Combining Authorization Modes: Real-World Example

Let's put it all together with a realistic API for a collaborative document editor. This API needs to serve multiple use cases: public document sharing, authenticated user accounts, team collaboration, and administrative backend operations.

```graphql
type Query {
  # Public: anyone can view published documents
  publicDocument(id: ID!): Document @aws_api_key
  publicDocuments(limit: Int!): [Document!]! @aws_api_key
  
  # Authenticated: users can view their own and shared documents
  myDocuments: [Document!]! @aws_cognito_user_pools
  sharedWithMe: [Document!]! @aws_cognito_user_pools
  document(id: ID!): Document @aws_cognito_user_pools
  
  # Team: authenticated users can see team info
  myTeams: [Team!]! @aws_cognito_user_pools
  team(id: ID!): Team @aws_cognito_user_pools
  
  # Admin: backend services only
  allDocuments(tenantId: ID!): [Document!]! @aws_iam
  documentAnalytics: DocumentAnalytics! @aws_iam @aws_lambda
}

type Mutation {
  # Authenticated mutations
  createDocument(input: CreateDocumentInput!): Document! @aws_cognito_user_pools
  updateDocument(id: ID!, input: UpdateDocumentInput!): Document! @aws_cognito_user_pools
  deleteDocument(id: ID!): Boolean! @aws_cognito_user_pools
  
  # Sharing requires authentication
  shareDocument(documentId: ID!, withUserId: ID!): DocumentShare! @aws_cognito_user_pools
  
  # Admin mutations
  publishDocument(id: ID!): Document! @aws_iam
  archiveDocument(id: ID!): Document! @aws_iam
}

type Document {
  id: ID!
  title: String!
  content: String!
  
  # Public metadata
  isPublished: Boolean!
  publishedAt: AWSDateTime
  
  # Author info - always visible if document is visible
  author: User!
  
  # Ownership and sharing - only visible to authorized users
  owner: User @aws_cognito_user_pools
  sharedWith: [DocumentShare!]! @aws_cognito_user_pools
  
  # Collaboration data
  contributors: [User!]! @aws_cognito_user_pools
  comments: [Comment!]! @aws_cognito_user_pools
}

type DocumentShare {
  id: ID!
  documentId: ID!
  sharedWith: User!
  sharedBy: User!
  permission: SharePermission!
  createdAt: AWSDateTime!
}

enum SharePermission {
  VIEW
  EDIT
  ADMIN
}

type Team {
  id: ID!
  name: String!
  members: [TeamMember!]! @aws_cognito_user_pools
}

type TeamMember {
  id: ID!
  user: User!
  role: TeamRole!
}

enum TeamRole {
  OWNER
  ADMIN
  MEMBER
  GUEST
}

type User {
  id: ID!
  email: String!
  displayName: String!
}

type Comment {
  id: ID!
  author: User!
  content: String!
  createdAt: AWSDateTime!
}

type DocumentAnalytics {
  totalDocuments: Int!
  activeUsers: Int!
  totalShares: Int!
}
```

Now, here's what the resolvers might look like for key operations:

```python
# Resolver for Query.document - allows both public and authenticated access
def query_document(event, context):
    doc_id = event['arguments']['id']
    document = fetch_document(doc_id)
    
    if not document:
        return None
    
    # If document is published, anyone can view it
    if document.get('isPublished'):
        return document
    
    # Otherwise, check if requesting user has access
    requesting_user = event['identity'].get('sub')
    if not requesting_user:
        return None
    
    # Allow if user is owner or document is shared with them
    if document['owner_id'] == requesting_user:
        return document
    
    if is_document_shared_with(doc_id, requesting_user):
        return document
    
    return None

# Resolver for Mutation.updateDocument - only authenticated users can update
def mutation_update_document(event, context):
    doc_id = event['arguments']['id']
    input_data = event['arguments']['input']
    requesting_user = event['identity']['sub']
    
    document = fetch_document(doc_id)
    
    # Check permissions: owner or admin
    if document['owner_id'] != requesting_user:
        # Check if user has edit permission via sharing
        share = get_share(doc_id, requesting_user)
        if not share or share['permission'] != 'EDIT' and share['permission'] != 'ADMIN':
            raise Exception("Unauthorized: cannot edit this document")
    
    # Update document
    updated = update_document_in_db(doc_id, input_data)
    return updated

# Resolver for Document.sharedWith - only visible to authenticated users
def document_shared_with(event, context):
    doc_id = event['source']['id']
    requesting_user = event['identity']['sub']
    document = event['source']
    
    # Only owner can see sharing details
    if document['owner_id'] != requesting_user:
        raise Exception("Unauthorized")
    
    return fetch_shares_for_document(doc_id)

# Resolver for Query.allDocuments - IAM only, for backend analysis
def query_all_documents(event, context):
    tenant_id = event['arguments']['tenantId']
    
    # Caller must be IAM-authenticated (schema enforces this)
    # We could still add additional checks here if needed
    documents = fetch_all_documents_for_tenant(tenant_id)
    return documents
```

This schema elegantly handles the complexity of a real application. Public documents are visible to anyone with an API Key. Authenticated users see their own and shared documents. Backend services see everything via IAM. The authorization logic is split between the schema (which declares which mode is required) and the resolvers (which implement fine-grained business logic).

The key insight is that schema-level directives provide a first-pass authorization check—a gating mechanism—while resolvers implement the nuanced rules. Both layers are necessary. The schema alone would be too simplistic (you can't declare "if document is shared with you" in schema directives), but resolvers alone would be inefficient and error-prone (you'd need to remember to implement authorization checks in every resolver).

### Common Pitfalls and Best Practices

Having reviewed the mechanics and patterns, let's discuss common mistakes and how to avoid them.

**Pitfall 1: Forgetting to Check Authorization in Resolvers**

It's tempting to rely entirely on schema directives for authorization. But schema directives only check the authentication mode—they don't implement business logic. A field with `@aws_cognito_user_pools` will allow any authenticated Cognito user to access it, even if they shouldn't.

Best practice: Always implement authorization checks in resolvers when business logic requires it. Think of schema directives as authentication (proving who you are) and resolvers as authorization (what you're allowed to do).

**Pitfall 2: Assuming `$ctx.identity` Has Expected Fields**

The shape of `$ctx.identity` varies by authorization mode. Code that works for Cognito-authenticated requests might crash on IAM-authenticated requests because IAM doesn't populate `cognito:groups`.

Best practice: Defensive programming. Check for the existence of fields before accessing them, or use a Lambda authorization function to normalize all identity contexts to a consistent schema.

**Pitfall 3: Using Long-Lived Secrets for API Keys**

API Keys are difficult to rotate and shouldn't be treated as secure long-term credentials. Storing them in client applications is particularly risky.

Best practice: Use API Keys only for development, testing, and truly public endpoints. For production, prefer Cognito (for user-facing apps), IAM (for service-to-service), or OIDC (for enterprise integration).

**Pitfall 4: Over-Using Lambda Authorization**

Lambda authorization is tempting because it's flexible, but it comes with latency and cost penalties. Using it for every authorization decision will slow down your API significantly.

Best practice: Use Lambda only when you genuinely need custom logic that other modes can't provide. For straightforward authentication and simple authorization rules, prefer Cognito, IAM, or OIDC.

**Pitfall 5: Ignoring Token Expiration**

Cognito and OIDC tokens expire, typically after an hour. Client applications must handle token refresh, or they'll start receiving authorization errors.

Best practice: Document token expiration in your API documentation and provide client SDKs with automatic refresh mechanisms. For mobile apps and SPAs, use a refresh token flow to transparently refresh access tokens before they expire.

**Pitfall 6: Mixing Authorization Concerns Across Layers**

Spreading authorization logic across schema directives, resolvers, and Lambda functions can make it hard to reason about what's actually authorized.

Best practice: Establish clear patterns in your team. For instance: schema directives handle authentication mode requirements, resolvers handle user-level ownership checks, and Lambda (if used) handles external integration and caching.

### Testing Authorization Logic

Authorization is security-critical, so testing deserves special attention. Each authorization mode requires slightly different testing strategies.

For API Key authorization, test that requests with valid keys succeed and requests with invalid or missing keys fail. Test that the API Key doesn't leak in logs or error messages.

For IAM authorization, test with different AWS roles and principals. Create IAM roles with various permission levels and verify that requests with those roles behave as expected. Use CloudTrail to verify that IAM calls are being logged.

For Cognito authorization, test with tokens in different states: valid tokens, expired tokens, tokens with different claims, and tokens without expected groups or attributes. Use Cognito's test user feature or generate tokens manually for testing.

For OIDC authorization, test with tokens from your OIDC provider, tokens with missing claims, and expired tokens. If possible, test with a dedicated test tenant in your OIDC provider.

For Lambda authorization, test the Lambda function independently with various input scenarios. Test that the function correctly validates tokens, handles errors gracefully, and returns appropriate context data.

In all cases, test both positive cases (authorized requests should succeed) and negative cases (unauthorized requests should fail). Test edge cases like requests missing expected headers or claims.

### Key Takeaways and Next Steps

AppSync's authorization system is powerful and flexible, but it requires understanding the distinct characteristics of each mode and how to combine them effectively.

API Key authorization is simple and suitable for public, development, and test scenarios. IAM authorization integrates with AWS's native identity system and is ideal for service-to-service communication. Cognito User Pools provides managed user authentication perfect for consumer-facing applications. OIDC enables integration with enterprise identity providers. Lambda authorization offers maximum flexibility for custom logic.

In practice, most production APIs use multiple modes simultaneously. Schema-level directives declare which modes are accepted for each field, providing a clear security contract. Resolvers implement fine-grained authorization logic that goes beyond simple authentication, using the rich identity context AppSync provides.

The most common pattern combines API Key for public endpoints, Cognito for authenticated user-facing operations, and IAM for backend services. More complex applications might add OIDC for enterprise integration or Lambda for custom authorization rules.

As you design your AppSync APIs, think carefully about your user personas (public visitors, authenticated users, backend services, administrators) and which authorization mode best serves each group. Use schema directives to establish clear boundaries, and implement resolver-level checks to enforce fine-grained business rules. Document your authorization design clearly, and test it thoroughly—authorization is security-critical code, and it deserves rigorous testing.

From there, explore advanced topics like attribute-based access control using custom claims, implementing audit logging for authorization decisions, and integrating AppSync with external policy engines. The authorization foundation you've built is the platform for these more sophisticated patterns.
