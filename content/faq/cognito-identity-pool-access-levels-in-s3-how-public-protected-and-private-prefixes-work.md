---
title: "Cognito Identity Pool Access Levels in S3: How Public, Protected, and Private Prefixes Work"
---

## Cognito Identity Pool Access Levels in S3: How Public, Protected, and Private Prefixes Work

Building secure, scalable applications on AWS often means managing fine-grained access control across multiple users and resources. When you're working with Amazon S3 and need to give users direct access to store and retrieve their own files—whether profile pictures, documents, or media—you face a real architectural challenge: how do you prevent users from accessing each other's data while still allowing them to manage their own?

This is where Cognito Identity Pools shine. Combined with S3 and a carefully constructed IAM policy, they enable a prefix-based access control model that's both elegant and powerful. Whether you're using AWS Amplify Storage (which abstracts away much of the complexity) or building the pattern manually, understanding how public, protected, and private prefixes work with Cognito Identity is essential knowledge for building production-grade AWS applications.

In this article, we'll explore how this access model works under the hood, examine the IAM policies that make it possible, and show you how to implement it both with and without Amplify.

### Understanding the Problem: Per-User S3 Access

Imagine you're building a photo-sharing application. Each user should be able to upload and download their own photos, but Alice shouldn't be able to see Bob's uploads, and vice versa. You could implement this entirely on your backend—forcing every S3 request to flow through your servers—but that introduces latency, increases your infrastructure costs, and creates a bottleneck.

Instead, you can grant users temporary AWS credentials through Cognito Identity Pools that allow them direct access to S3, with IAM policies that restrict what they can actually do. The trick is making those policies understand the concept of "their own" data without hardcoding individual user IDs into the policy itself.

This is where prefix-based access shines. By organizing your S3 bucket with a predictable folder structure and using IAM policy variables, you can create a single policy that grants each user access only to the parts of the bucket they should be able to reach.

### The Three-Tier Access Model: Public, Protected, and Private

AWS Amplify Storage popularized a specific prefix-based structure that's now a standard pattern. The model divides S3 access into three distinct tiers, each with different access semantics.

**Public access** is for data that any authenticated user—or even unauthenticated users—should be able to read. This might include community photos, published documents, or shared resources. Files stored under the `public/` prefix can be read by anyone but typically can only be written by the original uploader or administrators.

**Protected access** is for data that any authenticated user should be able to read, but only the owner can modify. This is useful for profile pictures, published blog posts, or other user-generated content that others might want to view but shouldn't alter. Files go under `protected/{identityId}/` where `{identityId}` is a unique identifier for the user's Cognito Identity.

**Private access** is the most restrictive tier. Only the user who owns the data can read or write it. This is where you'd store sensitive documents, medical records, or personal files. Files are stored under `private/{identityId}/`.

The beauty of this model is that it's implemented entirely through IAM policy variables. A single IAM policy, when assumed by a Cognito Identity, automatically adapts to each user's identity without requiring any customization.

### How Cognito Identity Pools Provide Credentials

Before diving into the policy mechanics, let's clarify how Cognito Identity Pools actually grant credentials to users.

When a user authenticates (either through a Cognito user pool, a third-party identity provider like Google or Facebook, or even unauthenticated access), they receive an identity ID from Cognito Identity. This identity ID is a unique string that represents that specific user's identity within your Cognito Identity Pool.

The user then calls the `GetCredentialsForIdentity` API (usually handled transparently by SDKs like Amplify), which returns temporary AWS credentials: an Access Key, Secret Key, and Session Token. These credentials are valid for a limited time (typically one hour by default) and are bound to an IAM role that you've configured.

The critical part: the IAM role's policy can reference the user's identity ID through a special policy variable. When AWS evaluates the policy, it replaces that variable with the actual identity ID of the user who owns the credentials. This substitution is what makes the magic work.

### The IAM Policy Variable: cognito-identity.amazonaws.com:sub

The key to this entire system is the IAM policy variable `cognito-identity.amazonaws.com:sub`. When you include this variable in an S3 resource ARN within an IAM policy, AWS substitutes it with the Cognito Identity ID of the user who is using those credentials.

Here's what a typical Amplify-generated policy looks like for a Cognito Identity role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-bucket/public/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-bucket/protected/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-bucket/private/${cognito-identity.amazonaws.com:sub}/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-bucket/protected/${cognito-identity.amazonaws.com:sub}/*"
      ]
    }
  ]
}
```

Let's break down what's happening in each statement:

The first statement grants anyone using this role full read, write, and delete access to the `public/*` prefix. Since the wildcard isn't scoped to a specific identity, all users can access all files there. This is where you'd put content that any authenticated user should be able to manage.

The second statement allows all users to read (GetObject) anything under `protected/*`. Notice there's no identity restriction here—the point of protected access is that it's readable by everyone.

The third statement restricts write access to protected content. Each user can only write to `protected/{their-identity-id}/*`. The policy variable ensures that when Alice's credentials are used, `${cognito-identity.amazonaws.com:sub}` evaluates to Alice's identity ID. Alice can therefore write to `protected/alice-id/*` but not to `protected/bob-id/*`.

The fourth statement is the private access tier. It's completely locked down to the individual user. A user can only perform any action (read, write, delete) on files under `private/{their-identity-id}/*`.

### Why This Design Works

This pattern is remarkably elegant because it solves several problems simultaneously:

First, it avoids the administrative overhead of creating individual IAM users or roles for every application user. You don't need to provision anything—every Cognito Identity can use the same role.

Second, it scales effortlessly. Whether you have 100 users or 10 million, the policy doesn't change. Each user's credentials automatically inherit the restrictions appropriate to their identity.

Third, it provides genuine security. The restrictions are enforced at the AWS API level. Even if a user somehow obtained the raw credentials (which they legitimately have), they couldn't escalate their access beyond what their identity allows. They can't construct a path like `private/someone-else-id/file.txt` and gain access to it—the IAM policy simply denies that action.

Fourth, it enables direct S3 access, which dramatically reduces latency and server load. Users can upload and download files directly to S3 without routing through your backend, as long as it's to the correct prefix for their identity.

### The Cognito Identity ID: What It Actually Is

You might be wondering: what exactly is a Cognito Identity ID, and how is it generated?

When a user first authenticates with your Cognito Identity Pool, they're assigned a unique 128-bit identifier that looks something like `us-east-1:12345678-1234-1234-1234-123456789012`. This ID is scoped to your specific Cognito Identity Pool and never changes for that user within your pool.

Critically, the Cognito Identity ID is different from a Cognito User Pool username or email. Even if you're using Cognito User Pools for authentication, the Identity Pool generates its own separate ID. This separation is intentional—the Identity Pool ID is specifically designed for granting AWS resource access, while the User Pool handles authentication and user management.

When you call `GetCredentialsForIdentity`, you pass the identity ID, and Cognito returns credentials that encode that identity. The IAM service later uses that encoded identity to evaluate the policy variables in your role's policies.

### Implementing the Pattern Without Amplify

While Amplify Storage abstracts away much of this complexity, understanding how to implement it manually is valuable both for learning and for scenarios where Amplify isn't available or appropriate.

Here's a step-by-step guide to setting up the three-tier S3 access pattern with Cognito Identity Pools without using Amplify:

**Step 1: Create or identify your S3 bucket.** This is straightforward—you need a bucket where you'll store the files. In our examples, we'll call it `my-app-storage`.

**Step 2: Create an IAM role for your Cognito Identity Pool.** You'll need a role that Cognito Identity will assume on behalf of your users. Let's call it `CognitoIdentityS3Role`. Create this role with a trust relationship that allows the Cognito Identity service to assume it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "cognito-identity.amazonaws.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "us-east-1:12345678-1234-1234-1234-123456789012"
        }
      }
    }
  ]
}
```

The `aud` condition should be your actual Cognito Identity Pool ID. This restricts the role to being assumed only through your specific pool.

**Step 3: Attach the S3 access policy to the role.** This is the core policy we discussed earlier. You'll attach a policy (inline or managed) that includes the public, protected, and private access statements.

**Step 4: Configure your Cognito Identity Pool to use this role.** In the Cognito Identity Pool console, set the "Authenticated role ARN" to point to `CognitoIdentityS3Role`.

**Step 5: From your client application, authenticate the user.** Use your authentication mechanism (Cognito User Pools, a third-party provider, or unauthenticated access) to get a Cognito Identity ID.

**Step 6: Obtain temporary AWS credentials.** Call the Cognito Identity `GetCredentialsForIdentity` API with the identity ID:

```bash
aws cognito-identity get-credentials-for-identity \
  --identity-id us-east-1:12345678-1234-1234-1234-123456789012 \
  --region us-east-1
```

This returns credentials that you can use (or pass to your client) to make S3 requests.

**Step 7: Use those credentials to interact with S3.** Whether from a backend service or a client-side SDK, you can now make S3 requests using those credentials. The IAM role's policy will evaluate each request and allow or deny it based on the prefix and the user's identity.

Here's a practical example: if a user with identity ID `us-east-1:alice` wants to upload a file, they would:

1. Authenticate and obtain the temporary credentials bound to their identity.
2. Make a PutObject request to `s3://my-app-storage/private/us-east-1:alice/my-file.txt`.
3. AWS evaluates the policy, sees that the resource matches `private/${cognito-identity.amazonaws.com:sub}/*` (where the variable evaluates to `us-east-1:alice`), and allows the request.

If that same user then tries to access `s3://my-app-storage/private/us-east-1:bob/my-file.txt`, the policy doesn't match, and the request is denied.

### Common Pitfalls and How to Avoid Them

Even with a clear understanding of the model, several gotchas can trip up developers implementing this pattern.

**Forgetting to URL-encode the identity ID.** When constructing S3 object paths, ensure that any special characters in the Cognito Identity ID (notably the colon in IDs like `us-east-1:12345678-...`) are properly handled. In most AWS SDKs this is automatic, but if you're constructing paths manually, be aware that S3 object keys are case-sensitive and special characters matter.

**Misconfiguring the trust relationship.** The IAM role's trust policy must allow the Cognito Identity service to assume the role, and the condition must match your Identity Pool ID. If this is wrong, users won't be able to obtain credentials at all. Double-check both the principal (must be the federated Cognito Identity service) and the condition.

**Using the wrong policy variable.** The variable must be `cognito-identity.amazonaws.com:sub`, not something like `aws:username` or other variables. These variables are specific to Cognito Identity and won't work with other authentication mechanisms. If you're using SAML or OpenID Connect, you might need different variables.

**Granting too much permission at the public level.** It's tempting to make the public prefix overly permissive, but remember that "public" here still means authenticated users only (unless you explicitly configure unauthenticated access). If you want truly public, world-readable access, you'd typically store those files in a different bucket or use CloudFront with S3, not grant Cognito access to modify them.

**Not considering versioning and lifecycle policies.** When implementing this pattern, think about how you'll handle deleted objects, file history, and storage cleanup. S3 versioning can help audit who accessed what, and lifecycle policies can ensure the bucket doesn't grow indefinitely with old, unused files.

### Amplify Storage: The Abstraction Layer

If you're using AWS Amplify, the JavaScript/TypeScript Amplify libraries handle much of this automatically. When you configure Amplify Storage, it detects your Cognito Identity Pool and automatically generates appropriate IAM policies.

Here's what Amplify does under the hood:

1. It creates an IAM role with the prefix-based policy we've described.
2. It configures your Cognito Identity Pool to use that role.
3. It provides a simple API (`Storage.put()`, `Storage.get()`, `Storage.remove()`) that automatically routes requests to the correct prefix based on the access level you specify.

When you call `Storage.put(key, file, { level: 'private' })`, Amplify prepends `private/{identityId}/` to the key and makes the S3 request. You don't have to think about identity IDs or policy variables—Amplify handles it.

This abstraction is powerful for rapid development, but understanding the underlying mechanism is crucial for debugging issues, customizing behavior, or implementing the pattern in environments where Amplify isn't available.

### Real-World Scenarios and Design Considerations

Let's consider a few real-world applications of this pattern and how you might adapt it:

**A social photo app** might have all user photos under `public/` so anyone can browse them, but store metadata (likes, comments, private notes) in DynamoDB rather than S3. The prefix-based access naturally maps to the use case.

**A document collaboration platform** might use `protected/{identityId}/` for documents a user creates (everyone can read, only the owner edits), and `private/{identityId}/` for drafts and temporary files. You might add additional tiers by creating more prefixes with appropriately scoped policies.

**A healthcare application** handling sensitive patient data would likely not use direct S3 access for patient records at all, instead keeping that data entirely server-side. But it might use the private tier for user preferences, uploaded test results, or historical records with proper encryption and audit logging.

**A mobile app with offline-first sync** might use the pattern to cache user-specific files locally, with the S3 tier serving as the authoritative source. The prefix structure ensures that offline-synced content goes to the right place even if the client is briefly misconfigured.

### Advanced Variations: When the Basic Model Isn't Enough

The standard three-tier model covers most use cases, but you can extend it for more complex scenarios.

**Multi-level hierarchies:** Instead of just `protected/{identityId}/`, you could have `protected/{identityId}/{project-id}/` for team-based access. You'd need to store the project ID or team membership somewhere (DynamoDB is a good choice) and validate it server-side before granting access, but the S3 prefix can be part of a larger URL structure.

**Shared resources:** For content that multiple users should be able to edit (team files, collaborative documents), you might use `shared/{group-id}/` and manage group membership through a database lookup. The IAM policy would grant access to the prefix, and your application logic would enforce which groups a user belongs to.

**Time-limited access:** While the prefix model doesn't directly support time-based restrictions, you can combine it with S3 object lock or temporary access keys with shorter TTLs for specific use cases.

**Encryption at rest:** The IAM policy enforces access control, but consider enabling S3 server-side encryption with AWS KMS for additional security. You can even use a KMS key policy to add another layer of access control, though this adds operational complexity.

### Testing Your Implementation

Once you've set up the pattern—whether with or without Amplify—you should thoroughly test the access controls.

A simple test approach:

1. Authenticate as User A and obtain their credentials and identity ID.
2. Attempt to read/write/delete objects in each tier (`public/`, `protected/{A-id}/`, `private/{A-id}/, protected/{B-id}/`, `private/{B-id}/`).
3. Verify that User A can access their own protected and private content but cannot access User B's.
4. Repeat for User B to confirm the restrictions work symmetrically.
5. Test that public access works as expected for multiple users.

You can do this through the AWS CLI, using temporary credentials obtained from Cognito:

```bash
# After obtaining credentials bound to a specific identity
aws s3 cp test-file.txt s3://my-app-storage/private/us-east-1:alice/test-file.txt \
  --region us-east-1

# This should work. Now try accessing someone else's private content:
aws s3 cp s3://my-app-storage/private/us-east-1:bob/test-file.txt test-file.txt \
  --region us-east-1

# This should fail with an AccessDenied error
```

Automated testing through your application's test suite ensures that as you evolve the system, access controls remain correct.

### Monitoring and Auditing Access

Once the system is in place, you'll want visibility into how it's being used. Enable S3 access logging to CloudWatch, and consider using CloudTrail to audit who accessed what and when. The CloudTrail logs will show the actual identity ID that was used for each request, giving you precise audit trails.

S3 block public access settings should be configured to prevent accidental over-sharing, even though the IAM policy is your primary defense. Defense in depth is a principle worth applying here.

### Moving Forward

The prefix-based access control model with Cognito Identity Pools is a proven, scalable pattern for managing per-user S3 access. Whether you use Amplify to abstract it away or implement it manually, understanding how it works—from the IAM policy variables to the credential flow—is essential knowledge for building secure AWS applications.

The pattern demonstrates a key architectural principle: leverage the AWS service layer for enforcement rather than building it into your application code. The access control is enforced at the API boundary, making it resistant to bugs and misconfigurations in your application code.

As you build your next application dealing with user-specific files, consider this pattern. It's straightforward to implement, requires no per-user provisioning, scales indefinitely, and provides genuine security through IAM's powerful policy evaluation engine. Whether you're storing profile photos, documents, or any other user-owned content, the public, protected, and private prefix structure, backed by Cognito Identity and IAM policy variables, is a battle-tested approach that works.
