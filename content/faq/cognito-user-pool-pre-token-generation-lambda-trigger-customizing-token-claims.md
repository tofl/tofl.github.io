---
title: "Cognito User Pool Pre-Token Generation Lambda Trigger: Customizing Token Claims"
---

## Cognito User Pool Pre-Token Generation Lambda Trigger: Customizing Token Claims

When your application needs to embed authorization logic directly into JWT tokens, Amazon Cognito's pre-token generation Lambda trigger becomes an indispensable tool. This serverless function executes right before Cognito issues ID and access tokens, giving you a critical moment to inject custom claims that shape how your backend services make authorization decisions. Understanding how to wield this trigger effectively transforms Cognito from a simple authentication provider into a sophisticated authorization engine tailored to your application's unique needs.

### Understanding the Pre-Token Generation Trigger

The pre-token generation trigger fires during the token generation phase of any Cognito authentication flow—whether a user is signing in directly, exchanging a refresh token, or completing an OAuth flow. Unlike other Cognito triggers that validate or transform user input, this trigger runs at the very end of the authentication process, with access to the complete user context and full permission to modify the tokens before they're issued.

Think of it as your last checkpoint before tokens leave Cognito's custody. At this point, you know the user is authenticated, you have access to their attributes, their group memberships, and any context from previous Lambda triggers. Armed with this information, you can make intelligent decisions about what claims should be embedded in the tokens—claims that your backend services will later inspect to grant or deny access to specific resources.

The trigger is remarkably flexible. You can add simple, custom claims like a user's department or tenant ID, or complex claims that encode role-based access control (RBAC) hierarchies. You can even modify Cognito's standard group configuration to reshape how user groups appear in tokens. This flexibility makes it powerful, but also demands careful consideration of security implications—something we'll explore in depth later.

### The Event Payload Structure

To work effectively with the pre-token generation trigger, you need to understand the structure of the event object Lambda receives. The event payload contains detailed information about the user, the token being generated, and the request context.

At the root level, you'll find properties like `request` and `response`. The `request` object is your primary source of information and contains several important nested properties. The `userAttributes` object holds the user's Cognito attributes—their username, email, custom attributes, and any other profile data stored in your user pool. The `groupConfiguration` object reveals which groups the user belongs to, along with any group-specific attributes. The `tokenUse` property tells you whether the trigger is processing an ID token or an access token, which is crucial because you might want to include different claims in each.

The `response` object is where you express your modifications. This object contains `claimsOverrideDetails`, which is the structure you'll manipulate to add, modify, or suppress claims. Within `claimsOverrideDetails`, you have several properties: `claimsToAddOrOverride` is a key-value object where you add or overwrite claims; `claimsToSuppress` is an array of claim names you want to remove from the token; and `groupConfiguration` allows you to reshape how groups appear in the token.

Here's what a typical event structure looks like when serialized:

```json
{
  "request": {
    "userAttributes": {
      "sub": "12345-67890",
      "email": "user@example.com",
      "email_verified": "true",
      "custom:department": "engineering",
      "custom:tenant_id": "tenant-42"
    },
    "groupConfiguration": {
      "groupsToOverride": ["developers", "admins"],
      "iamRolesToOverride": ["arn:aws:iam::123456789012:role/developer"],
      "preferredRole": "arn:aws:iam::123456789012:role/developer"
    },
    "tokenUse": "id"
  },
  "response": {
    "claimsOverrideDetails": {
      "claimsToAddOrOverride": {},
      "claimsToSuppress": [],
      "groupConfiguration": {
        "groupsToOverride": [],
        "iamRolesToOverride": [],
        "preferredRole": null
      }
    }
  }
}
```

Understanding this structure is the foundation for everything that follows. Each property serves a specific purpose, and mastering how to read and manipulate them is what separates a basic token customization implementation from a robust, maintainable one.

### Adding Custom Claims to Tokens

The most straightforward use of the pre-token generation trigger is adding custom claims directly to tokens. This is where `claimsToAddOrOverride` comes into play. Any key-value pairs you add to this object will be included in the token when it's issued.

For example, imagine you're building a SaaS application where users belong to organizations, and you want to embed the organization ID in the token so your API gateway can quickly route requests to the correct tenant's backend. Your Lambda function might look like this:

```python
import json

def lambda_handler(event, context):
    user_attributes = event['request']['userAttributes']
    tenant_id = user_attributes.get('custom:tenant_id', 'default')
    
    # Add custom claim for tenant isolation
    event['response']['claimsOverrideDetails']['claimsToAddOrOverride'] = {
        'tenant_id': tenant_id,
        'issued_at': int(time.time())
    }
    
    return event
```

When this token is later decoded by your backend service, it will contain a `tenant_id` claim that can be used to ensure the user can only access their organization's data. This pattern eliminates the need for your backend to look up tenant information on every request—it's already there in the token.

The same principle applies to role-based access control. If you maintain roles in a custom database or directory service, you can fetch those roles during the pre-token generation trigger and embed them directly into the token:

```python
def lambda_handler(event, context):
    user_id = event['request']['userAttributes']['sub']
    
    # Fetch user roles from DynamoDB or other service
    roles = fetch_user_roles(user_id)
    
    event['response']['claimsOverrideDetails']['claimsToAddOrOverride'] = {
        'roles': roles
    }
    
    return event
```

Now your access token carries the user's roles, and your API endpoints can immediately determine what actions the user is authorized to perform without additional database lookups. This approach significantly reduces latency and external service dependencies during authorization checks.

### Manipulating Group Configuration

Cognito has built-in support for user groups, but the pre-token generation trigger lets you reshape how those groups appear in tokens. This is handled through the `groupConfiguration` object in `claimsOverrideDetails`.

The `groupConfiguration` property contains three sub-properties: `groupsToOverride` is an array of group names you want to appear in the token; `iamRolesToOverride` contains IAM role ARNs associated with the groups; and `preferredRole` specifies which IAM role should be the primary one if the user belongs to multiple groups with different roles.

This is particularly useful when you want to apply business logic to group membership. For instance, you might have a scenario where a user's group membership in Cognito doesn't directly map to your application's permission model. Perhaps your application uses hierarchical roles, but Cognito groups are flat. The pre-token generation trigger is where you resolve that mismatch.

Consider a healthcare application where Cognito has groups like "nurses," "doctors," and "administrators," but your application's permission model includes sub-roles like "senior_nurse" or "resident_doctor." You can use the trigger to compute these derived roles based on additional user attributes:

```python
def lambda_handler(event, context):
    user_attributes = event['request']['userAttributes']
    cognito_groups = event['request']['groupConfiguration']['groupsToOverride']
    years_of_experience = int(user_attributes.get('custom:years_experience', 0))
    
    # Enrich groups with seniority information
    enhanced_groups = []
    for group in cognito_groups:
        if group == 'nurses' and years_of_experience >= 5:
            enhanced_groups.append('senior_nurse')
        elif group == 'nurses':
            enhanced_groups.append('junior_nurse')
        else:
            enhanced_groups.append(group)
    
    event['response']['claimsOverrideDetails']['groupConfiguration']['groupsToOverride'] = enhanced_groups
    
    return event
```

This approach gives you tremendous flexibility. You can enrich group information with business logic, suppress groups you don't want in the token, or completely restructure how groups are represented. The key is remembering that the groups you specify here are what will appear in the token—not the original Cognito group memberships.

### Real-World Use Cases

Let's explore several practical scenarios where the pre-token generation trigger becomes essential for modern application architecture.

**Role and Permission Claims** form the foundation of many authorization systems. Rather than embedding roles as a simple array, you might encode an entire permission set. A financial application might compute a permission matrix based on the user's role, their department, and their approval authority level, then encode all of that into a single claim that API endpoints can evaluate without calling back to a database.

**Tenant Isolation Markers** are critical in multi-tenant SaaS applications. By embedding tenant IDs, organization IDs, or workspace identifiers in tokens, you ensure that your backend services can instantly determine which data partition a user has access to. This pattern is particularly important for serverless architectures where cold starts make database lookups expensive.

**Feature Flags and Experimentation** represent an emerging pattern where tokens carry information about which features a user is eligible for. If you're running A/B tests or gradual feature rollouts, the pre-token generation trigger can determine a user's experiment cohort based on their ID, then encode that into a claim. Your frontend and backend can then conditionally enable features without calling a feature flag service.

**Time-Limited Elevated Access** is another sophisticated use case. Imagine a system where users can request temporary elevated permissions for specific operations. The pre-token generation trigger can check if such a request exists, verify it hasn't expired, and include an `elevated_until` claim in the token. Your API endpoints can then enforce that elevated operations are only allowed until that timestamp.

**Custom Attributes and Metadata** frequently need to be surfaced to your application logic. If you store custom attributes in Cognito like `department`, `cost_center`, or `clearance_level`, the pre-token generation trigger is where you ensure these reach the token. This is more efficient than having your backend services query Cognito's user pool every time they need this information.

### Security Implications of Custom Claims

Adding custom claims to tokens introduces security considerations that deserve careful attention. Tokens are often visible in network logs, browser storage, or error messages. Any sensitive data you embed in a token becomes part of those records.

First, understand that JWT tokens are not encrypted by default—they're only signed. A base64-decoded token is readable in plain text. This means you should never include sensitive credentials, API keys, database passwords, or personally identifiable information (PII) like social security numbers in tokens. Instead, include identifiers that let your backend look up sensitive data from secure storage.

For example, if you need a user's credit card information for a transaction, don't embed the card number in the token. Instead, embed a payment method ID, and have your backend service look up the actual card details from encrypted storage using that ID. The token should be the key to authorization, not the vault of sensitive data.

Another consideration is token size. Each claim you add increases the token's byte length, which affects network transmission costs and storage overhead if tokens are logged extensively. Avoid embedding large data structures or lists that could be computed by your backend instead. A user's ten thousand permission strings don't belong in a token; a permission ID that references a permissions set in your database does.

Token expiration is also relevant to custom claims. If a token is valid for an hour, any custom claims you embed are frozen for that hour. If a user's group membership or roles change, they won't see the updated claims until they re-authenticate and receive a new token. In scenarios where permissions need to update in real-time, you should either use short token lifespans or include a version number in your claim that your backend checks against current data.

Consider implementing claim validation in your Lambda function. Don't blindly trust that a user attribute exists or that a lookup succeeded. Implement error handling so that if a claim cannot be computed, you either fail safely or provide a secure default:

```python
def lambda_handler(event, context):
    user_id = event['request']['userAttributes']['sub']
    
    try:
        permissions = fetch_user_permissions(user_id)
        if not permissions:
            # User has no permissions assigned
            permissions = []
    except Exception as e:
        # Lookup failed - default to minimal permissions
        print(f"Error fetching permissions: {e}")
        permissions = []
    
    event['response']['claimsOverrideDetails']['claimsToAddOrOverride'] = {
        'permissions': permissions
    }
    
    return event
```

Finally, be mindful of claim naming. Use descriptive names that clearly indicate what data is being conveyed. Avoid generic names like `data` or `custom1` that obscure intent. This makes security audits easier and helps prevent naming collisions if multiple systems are adding claims to the same token.

### Implementing the Trigger in Practice

Setting up a pre-token generation trigger involves several steps. First, you create a Lambda function in the AWS account where your Cognito user pool resides. The function must have an IAM role with permissions to any AWS services it needs to call—for instance, if it queries DynamoDB for roles, it needs `dynamodb:GetItem` permissions.

The Lambda function should follow the handler pattern of receiving the event and context, modifying the event's response object, and returning the event. Cognito expects the modified event back as the return value. Here's a more complete example that demonstrates a real-world pattern:

```python
import json
import boto3
import time

dynamodb = boto3.resource('dynamodb')
roles_table = dynamodb.Table('UserRoles')

def lambda_handler(event, context):
    user_id = event['request']['userAttributes']['sub']
    email = event['request']['userAttributes']['email']
    token_use = event['request']['tokenUse']
    
    # Only modify ID tokens; keep access tokens minimal
    if token_use != 'id':
        return event
    
    try:
        # Fetch user roles from DynamoDB
        response = roles_table.get_item(Key={'user_id': user_id})
        roles = response.get('Item', {}).get('roles', [])
        
        # Fetch tenant information
        tenant_id = event['request']['userAttributes'].get('custom:tenant_id', 'unknown')
        
        claims_to_add = {
            'roles': roles,
            'tenant_id': tenant_id,
            'token_generated_at': int(time.time())
        }
        
        # For admin users, include additional metadata
        if 'admin' in roles:
            claims_to_add['is_admin'] = True
        
        event['response']['claimsOverrideDetails']['claimsToAddOrOverride'] = claims_to_add
        
    except Exception as e:
        print(f"Error in pre-token generation: {e}")
        # Fail safely with minimal claims
        event['response']['claimsOverrideDetails']['claimsToAddOrOverride'] = {
            'tenant_id': 'unknown'
        }
    
    return event
```

Once your Lambda function is ready, you attach it to your Cognito user pool through the console or infrastructure-as-code tool. In the user pool settings under "App integration," you'll find the Lambda triggers section. Select "Pre token generation" and choose your function.

It's crucial to test the trigger thoroughly. Use the Cognito console's test interface or create a test user and authenticate through your application, then decode the resulting token to verify that your custom claims appear correctly. You can decode JWTs using online tools or libraries in your preferred language—just remember never to paste real tokens into public websites.

Monitor the Lambda function's performance and errors. The pre-token generation trigger fires on every authentication event, so any performance issues directly impact your authentication latency. Consider implementing distributed tracing with X-Ray to identify bottlenecks. If your trigger queries external services, implement timeouts to prevent slow downstream services from degrading the authentication experience.

### Decoding and Validating Custom Claims

Once tokens are issued with custom claims, your backend services need to decode and validate them. While Cognito handles signature verification if you use the JWT libraries correctly, you're responsible for validating claim contents in your business logic.

Decoding JWTs is straightforward in most languages. Here's how you'd do it in JavaScript:

```javascript
const jwt = require('jsonwebtoken');

function validateTokenAndExtractClaims(token, cognitoPublicKey) {
    try {
        const decoded = jwt.verify(token, cognitoPublicKey, {
            algorithms: ['RS256']
        });
        
        // Access custom claims
        const tenantId = decoded.tenant_id;
        const roles = decoded.roles || [];
        
        return {
            valid: true,
            userId: decoded.sub,
            tenantId,
            roles
        };
    } catch (error) {
        console.error('Token validation failed:', error);
        return { valid: false };
    }
}
```

After decoding, validate that the claims make sense in the context of the current request. If a user claims a specific tenant ID, verify that the requested resource belongs to that tenant. If a user claims an admin role, double-check that claim against your authorization rules before granting administrative access.

This defense-in-depth approach—validating claims in your backend rather than blindly trusting them—protects against two scenarios: a malicious actor attempting to forge claims (though JWT signatures prevent this if you validate correctly), or a legitimate claim that has become stale due to the time between token issuance and request processing.

### Comparing ID and Access Tokens

The pre-token generation trigger fires for both ID and access tokens, but they serve different purposes, and you might want different claims in each.

ID tokens are designed for your frontend application and contain claims about the user's identity—name, email, groups, and authentication details. Access tokens are designed for APIs and contain claims about what the user is authorized to do. The `tokenUse` property in the event tells you which type is being generated.

A common pattern is to include detailed user profile information in the ID token but keep the access token focused on authorization claims:

```python
def lambda_handler(event, context):
    token_use = event['request']['tokenUse']
    user_attributes = event['request']['userAttributes']
    
    if token_use == 'id':
        # Include identity and profile claims
        claims = {
            'full_name': user_attributes.get('name'),
            'email': user_attributes.get('email'),
            'department': user_attributes.get('custom:department'),
            'tenant_id': user_attributes.get('custom:tenant_id')
        }
    else:  # token_use == 'access'
        # Include only authorization-relevant claims
        roles = fetch_user_roles(user_attributes['sub'])
        claims = {
            'roles': roles,
            'tenant_id': user_attributes.get('custom:tenant_id')
        }
    
    event['response']['claimsOverrideDetails']['claimsToAddOrOverride'] = claims
    return event
```

This separation is a security best practice. It limits the attack surface of the access token—which is sent to multiple APIs and has a higher chance of exposure—while allowing the ID token to carry richer information for the frontend.

### Conclusion

The pre-token generation Lambda trigger is a powerful tool for embedding authorization logic into JWT tokens at the moment of issuance. By understanding the event payload structure, the claims you can add or override, and how to manipulate group configurations, you gain the ability to build sophisticated, efficient authorization systems that don't depend on constant backend lookups.

The patterns you've explored here—tenant isolation, role-based claims, group enrichment, and feature flags—represent just the beginning. As you build your applications, you'll discover additional use cases for custom claims that address your specific authorization requirements.

Remember to balance capability with security. Not every piece of information should live in a token. Include identifiers and authorization markers that let your backend services make decisions efficiently, but keep sensitive data secure in backend storage. Monitor token size and function performance to ensure authentication latency remains acceptable. And always validate claims in your backend services rather than trusting them blindly.

With careful implementation and thoughtful claim design, the pre-token generation trigger transforms Cognito from a simple authentication provider into a comprehensive authorization platform that scales with your application's complexity.
