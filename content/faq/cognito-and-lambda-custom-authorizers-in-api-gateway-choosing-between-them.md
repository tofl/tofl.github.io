---
title: "Cognito and Lambda Custom Authorizers in API Gateway: Choosing Between Them"
---

## Cognito and Lambda Custom Authorizers in API Gateway: Choosing Between Them

When you're building a REST API on AWS, you'll quickly face a decision that shapes your security architecture: should you use Amazon Cognito's native integration with API Gateway, or build a custom Lambda authorizer? Both solve the authorization problem, but they take fundamentally different approaches. Understanding when to reach for each tool—and why—is essential for building secure, maintainable APIs without over-engineering or leaving gaps in your access control.

This is more than just a feature comparison. It's about recognizing that authorization isn't one-size-fits-all. Cognito excels at straightforward, standards-based user authentication and authorization. Lambda custom authorizers shine when your authorization logic is complex, context-dependent, or tied to your business rules. The right choice depends on what you're trying to protect and how sophisticated your access control needs to be.

### Understanding API Gateway Authorization Fundamentals

Before we compare solutions, let's establish what authorization actually means in the context of API Gateway. When a client makes a request to your API, something needs to decide whether that client is allowed to proceed. This decision-making layer sits in front of your integration—whether that's a Lambda function, HTTP endpoint, or AWS service.

API Gateway supports several authorization mechanisms, but the two most relevant for this discussion are built-in Cognito authorization and custom Lambda authorizers. Both intercept requests before they reach your business logic, extract credentials or tokens, validate them, and return a decision: allow or deny.

The critical difference lies in how that validation happens and where your logic lives. Cognito handles the mechanical work of parsing and validating JSON Web Tokens (JWTs) that it issued. A Lambda authorizer, by contrast, is a function you write that receives the request details and returns an authorization decision—and you control every aspect of that logic.

### The Cognito Native Authorizer: Simplicity by Design

When you attach a Cognito User Pool authorizer directly to an API Gateway method, you're leveraging AWS's managed service for user identity and access tokens. Here's what happens behind the scenes: the client calls your API with an Authorization header containing a JWT token. API Gateway extracts that token, validates its signature against the Cognito User Pool's public keys, checks that it hasn't expired, and if everything passes, allows the request through to your integration.

The beauty of this approach is simplicity. You don't write any authorization code. You don't manage token validation logic or worry about key rotation—Cognito handles all of that. Configuration is straightforward: in the AWS Console or Infrastructure-as-Code tool, you specify which User Pool to trust, and API Gateway does the rest.

This approach works exceptionally well for straightforward scenarios. Imagine you're building an internal tool where employees authenticate through a Cognito User Pool. You want to ensure that only authenticated employees can call your APIs. Cognito's native integration solves this entirely. The token itself carries claims about the user—their username, groups, custom attributes—and your backend Lambda can inspect those claims if needed, but API Gateway's authorization check is purely about token validity.

The performance characteristics are excellent. Token validation is fast because it's local to API Gateway—no network calls required beyond your initial Cognito setup. The public keys used for validation are cached, so even the cryptographic validation overhead is minimal.

From a cost perspective, there's no additional charge for using Cognito's native authorizer. Cognito charges for user authentications and monthly active users, but the authorization mechanism itself is free.

### Lambda Custom Authorizers: Flexibility at a Cost

A Lambda custom authorizer, also called a Lambda authorizer, inverts the responsibility model. Instead of API Gateway making a yes/no decision based on token structure, it calls your Lambda function with details about the incoming request. Your function inspects that request—the Authorization header, query parameters, request context, anything accessible—and returns an authorization decision and optional policy document.

This flexibility is powerful. Your Lambda can implement authorization logic that goes far beyond token validation. Consider a real-world example: you're building a multi-tenant SaaS platform where users belong to organizations, and each organization has custom permission rules. When a user requests to access an organization's data, your authorization Lambda can look up that user's role, fetch the organization's permission policy from DynamoDB, check whether the requested resource belongs to that organization, and make an informed decision. Cognito's native authorizer simply cannot do this—it validates tokens, nothing more.

Another common use case is rate limiting or request frequency analysis. Your Lambda authorizer can check DynamoDB to see how many requests this user has made in the last minute and deny access if they're exceeding their quota. Or consider attribute-based access control (ABAC): your Lambda can inspect custom claims in the token, cross-reference them with resource attributes, and make fine-grained decisions about who can access what.

The performance implications are more complex than Cognito's native approach. Every authorization decision requires a Lambda invocation, which means cold starts are possible (though AWS caches authorization results for up to one hour, mitigating this for repeat requests). If your Lambda makes database calls, those add network latency. This isn't to say it's slow—modern Lambda execution is fast—but it's measurably slower than local token validation.

Cost considerations matter here. Lambda custom authorizers incur charges for every invocation. In a high-traffic API, this can become significant. If you're processing millions of requests daily, even at the generous Lambda free tier limits, authorizer costs can accumulate.

### Cognito Authorizer Limitations and When They Matter

Cognito's native authorizer excels at one thing: validating that a token is legitimate and hasn't expired. It cannot do much beyond that. Understanding these boundaries helps you recognize when you need a custom authorizer.

First, Cognito validates the token's signature and expiration, but it doesn't perform any business logic-dependent authorization. You cannot use a native Cognito authorizer to check whether a user has permission to access a specific resource, whether they belong to a particular organization, or whether they've exceeded rate limits. If you need those decisions, you need a Lambda.

Second, Cognito's scope validation is limited. A token's scopes are predetermined and embedded in the token itself. If your authorization rules change—a user's role changes, their organization's permissions shift—the token doesn't automatically reflect those changes. If you need real-time, dynamic authorization decisions, a Lambda can check current state in your database, while Cognito is bound by what was encoded in the token when it was issued.

Third, if you're using a third-party identity provider or non-Cognito tokens, the native Cognito authorizer won't help. Some organizations use Auth0, Okta, or custom OAuth providers. In these cases, you'll need a Lambda to validate those tokens and implement your authorization logic.

Finally, if your authorization needs are heterogeneous across your API—different endpoints require different authorization logic, some require complex context-dependent decisions while others just need basic authentication—Cognito can't help with the complex cases. You'd end up building Lambda authorizers anyway.

### Lambda Custom Authorizers: When Complexity Is Your Friend

The primary reason to build a Lambda custom authorizer is that your authorization logic is genuinely complex. Let's walk through a realistic scenario to illustrate this.

Imagine you're building a document management system. Users belong to teams, and teams have projects. A user should be able to list documents in their teams' projects, update documents they created, and share documents with specific team members. Different users have different roles—some are project leads with elevated permissions, others are regular contributors.

Your Cognito token carries the user's ID and their list of teams, but it doesn't know which documents exist, which teams own them, or what the current project structure is. Every authorization decision requires looking at current state in your database. Your Lambda authorizer would receive the request, extract the user ID and requested resource ID from the request path, query DynamoDB to look up the resource's owning team and current permissions, verify that the user belongs to that team, check their role, and make a decision. This is fundamentally impossible with a native Cognito authorizer.

Another strong use case is implementing custom authentication mechanisms. If you need to validate API keys stored in DynamoDB, check IP whitelists, or validate signatures from IoT devices, a Lambda authorizer gives you complete control over the validation logic. Cognito's native authorizer only understands Cognito-issued tokens.

Rate limiting and quota enforcement are also natural Lambda authorizer use cases. Your function can query a DynamoDB table tracking request counts per user or API key, increment the count, check against quotas, and deny requests that exceed limits. This is real-time, flexible, and entirely customizable.

Token enrichment is a subtle but valuable capability. Your Lambda can inspect an incoming token, call downstream services to gather additional context about that user, and pass enriched information to your backend through the authorization context. For example, you could fetch the user's organization ID from a database and pass it to your Lambda integration, so your business logic code automatically knows which organization is making the request.

### Performance and Caching Considerations

Understanding how API Gateway caches authorization results is crucial for making a cost-effective choice. API Gateway can cache authorization responses from both Cognito authorizers and Lambda authorizers, but the caching behavior differs significantly.

With Cognito's native authorizer, caching is automatic and happens at the API Gateway level. The same token, when presented multiple times, doesn't trigger repeated validation—API Gateway uses its cached result. This is efficient because token validation is deterministic: the same token always yields the same result.

Lambda authorizers support caching as well, but it's more nuanced. You specify a cache key based on request parameters—typically the Authorization header. API Gateway caches the authorization result based on this key. However, if your Lambda authorizer's decision depends on factors beyond the token itself (like current time for rate limiting, or database state), caching can become problematic. A cached authorization result that was valid five minutes ago might be invalid now if state has changed. You can configure cache TTL (time-to-live) to balance freshness and performance, but this requires careful thought about your use case.

In practice, if your authorization decision is purely token-based and doesn't depend on time-varying state, Lambda authorizer caching performs similarly to Cognito's native approach. If your decision depends on current state, you'll either need short cache TTLs (reducing the performance benefit) or accept eventual consistency in your authorization decisions.

### Decision Framework: Choosing Your Approach

So, which should you choose? Start by answering these questions in order:

**Is your authorization decision purely token validation?** If yes, Cognito's native authorizer is almost certainly the right choice. It's simpler, faster, and cheaper. You're using a managed service for what it's designed to do.

**Do you need to make authorization decisions based on current state outside the token?** This includes checking database records, looking up current user roles or permissions, validating resource ownership, or implementing rate limits. If yes, you need a Lambda authorizer because Cognito cannot access or reason about state outside the token itself.

**Are you using Cognito User Pools for authentication?** This isn't a requirement for Cognito's native authorizer, but if you are, it's one less integration point to manage. If you're using a different identity provider, Lambda becomes more attractive because it can validate any token format you choose.

**How sensitive is authorization latency in your use case?** For APIs where every millisecond matters, Cognito's native authorizer has a measurable edge. For most APIs, the difference is negligible, but it's worth considering if you're building real-time trading systems or similar latency-critical services.

**What's your request volume and cost sensitivity?** At high volume, Lambda authorizer costs can add up. If cost is a primary concern and your authorization needs are simple, Cognito's native approach is cheaper. If your authorization is complex enough that you'd need a Lambda anyway, the cost is justified by the capability.

### Practical Implementation: Cognito Native

Let's briefly look at what implementation looks like for each approach. For a Cognito native authorizer, you're essentially configuring API Gateway to trust a Cognito User Pool.

In Infrastructure-as-Code (using CloudFormation, SAM, or Terraform), you'd specify your API Gateway method with an authorizer that references your Cognito User Pool. In CloudFormation, this looks like specifying an `AWS::ApiGateway::Authorizer` resource with type `cognito_user_pools` and the User Pool ARN.

In the AWS Console, you navigate to your API Gateway, select a method, click on Authorization Settings, and choose Cognito User Pool Authorizer, then select your User Pool. That's genuinely all the configuration required.

Your backend Lambda functions can access the authorization context to read claims from the token. API Gateway passes these as `$context.authorizer` variables in the integration request mapping template, or they're available in the Lambda event under `requestContext.authorizer`.

```
{
  "requestContext": {
    "authorizer": {
      "principalId": "user-123",
      "claims": {
        "sub": "user-123",
        "email": "user@example.com",
        "cognito:groups": ["developers", "admins"]
      }
    }
  }
}
```

This is about as simple as authorization gets. Cognito handles token validation, you read the result from the event.

### Practical Implementation: Lambda Custom Authorizer

A Lambda custom authorizer is a function that receives the event and returns a policy document. Here's the basic structure:

```
export const handler = async (event) => {
  const token = event.authorizationToken;
  
  // Validate token (could check signature, call external service, etc.)
  const claims = validateToken(token);
  
  if (!claims) {
    throw new Error('Unauthorized');
  }
  
  // Optional: make authorization decisions based on claims and request context
  const resource = event.methodArn;
  
  return {
    principalId: claims.sub,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: resource
        }
      ]
    },
    context: {
      userId: claims.sub,
      email: claims.email
    }
  };
};
```

This function receives the request authorization header and the method ARN (which includes the API Gateway method being called). It returns a policy document that tells API Gateway whether to allow or deny the request, and an optional context object that your backend Lambda can access.

For more complex scenarios, you'd add database lookups, role checking, and business logic-specific validation. The advantage is that every part of this function is under your control.

### Hybrid Approaches: The Best of Both Worlds

In practice, many sophisticated systems use both. A common pattern is Cognito's native authorizer for basic authentication—ensuring a valid user is making the request—combined with resource-level authorization in your backend Lambda functions.

Another pattern uses Cognito's native authorizer for most endpoints but implements a custom Lambda authorizer for specific endpoints with complex authorization needs. You might have simple CRUD endpoints that use Cognito's authorizer and an admin endpoint that uses a Lambda authorizer that checks role-based access control policies.

This hybrid approach lets you keep things simple where possible while introducing complexity only where it's genuinely needed.

### Monitoring and Debugging Authorization Issues

Regardless of which approach you choose, understanding what's happening during authorization is essential for troubleshooting. For Cognito's native authorizer, CloudWatch logs show token validation successes and failures. For Lambda authorizers, you have full Lambda logging at your disposal—you can log the incoming request, your authorization decision logic, and the resulting policy document.

Common issues with Cognito authorizers include token expiration (the user needs to re-authenticate), clock skew (the validating service's time is out of sync with Cognito's), and scope mismatches. Enable CloudWatch logging on your API Gateway to see authorization failures in detail.

With Lambda authorizers, the most common issues are token validation failures (if you're validating third-party tokens), exceptions in your authorization logic, and unexpectedly cached authorization decisions. Lambda CloudWatch logs will show exceptions and any debug logging you've added.

### Scaling Considerations

As your API scales, authorization becomes a potential bottleneck. Cognito's native authorizer scales transparently—AWS manages the infrastructure, and token validation is extremely fast. Lambda authorizers scale as well, but you're paying per invocation, and authorization decisions that require database lookups can introduce latency under load.

If you're implementing a Lambda authorizer with database access, consider implementing appropriate caching at multiple levels: API Gateway's built-in caching, application-level caching within your Lambda (using environment state during warm execution), and database query caching strategies. These techniques can significantly reduce the operational load and cost of complex authorization logic.

### Conclusion

Cognito's native authorizer and Lambda custom authorizers represent two ends of a spectrum: simplicity versus flexibility. Cognito wins when your authorization is straightforward—validating that a user is authenticated and hasn't been revoked. Lambda authorizers win when your authorization logic is inseparable from your business rules, requiring real-time decision-making based on current state.

The key insight is recognizing that this isn't about one being objectively better. It's about choosing the right tool for the specific authorization problem you're solving. Start with the simplest approach that solves your problem. Use Cognito's native integration for basic token validation. Add a Lambda authorizer when you need complex, context-dependent authorization logic. In sophisticated systems, you might use both, leveraging each where it provides the most value.

By understanding the strengths and limitations of each approach, you'll build authorization systems that are secure, efficient, and maintainable—avoiding both over-engineering and under-delivering on your security requirements.
