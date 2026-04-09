---
title: "2. KMS (Key Management Service) — Foundations"
type: docs
weight: 2
---

## KMS (Key Management Service) — Foundations

AWS Key Management Service (KMS) is a managed service that lets you create and control the cryptographic keys used to protect your data. The core problem it solves is straightforward: encrypting data is necessary, but managing encryption keys securely is hard. KMS offloads that complexity — key storage, access control, rotation, and audit logging — to AWS, so you never handle raw key material directly in your application code.

KMS is deeply integrated across AWS services. Once you understand how it works, you'll recognize its presence everywhere: S3 server-side encryption, DynamoDB encryption at rest, SQS encrypted queues, Secrets Manager, and many more.

### Encryption at Rest vs. In Transit

These are two distinct problems that require different solutions.

**Encryption in transit** protects data moving over a network — typically enforced via TLS/HTTPS. AWS services expose HTTPS endpoints by default, so this is often handled for you.

**Encryption at rest** protects data stored on disk. If someone physically accessed a storage device, encrypted data would be unreadable without the key. KMS specifically addresses this problem.

### KMS Key Types

KMS organizes keys into three ownership tiers [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#key-mgmt):

- **Customer Managed Keys (CMK)** — Keys you create, own, and manage. You control the key policy, can enable/disable the key, configure rotation, and use it across services. These appear in your account under KMS and incur a monthly charge per key.
- **AWS Managed Keys** — Created automatically by AWS services on your behalf (e.g., `aws/s3`, `aws/dynamodb`). You can view them but cannot manage them directly. Rotation is handled automatically every year.
- **AWS Owned Keys** — Fully internal to AWS; used across multiple accounts for baseline encryption on some services. You have no visibility into or control over these.

For the exam and for real-world usage, Customer Managed Keys are the most important tier — they're what you configure when you need control over access, rotation, or cross-account usage.

### KMS Key Policies and Grants

Every KMS key has a **key policy** — a resource-based policy (similar in structure to an S3 bucket policy) that defines who can use and who can administer the key [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html). This is the primary access control mechanism for KMS. Unlike most AWS resources, IAM policies alone are not sufficient — the key policy must explicitly allow the account root or specific principals to use the key.

A key policy has two conceptually distinct sections:
- **Key administrators** — IAM principals who can manage the key (update policy, enable/disable, schedule deletion), but not necessarily use it for encryption.
- **Key users** — IAM principals (users, roles, other accounts) allowed to call the cryptographic API actions.

**Grants** are a programmatic alternative for delegating key usage to AWS services or other principals temporarily, without modifying the key policy [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/grants.html). You'll encounter grants when AWS services like EBS or S3 request access to a key on behalf of your account.

### Core KMS API Actions

These four API calls are the foundation of everything KMS does [🔗](https://docs.aws.amazon.com/kms/latest/APIReference/API_Operations.html):

- **`Encrypt`** — Takes plaintext (up to 4 KB) and a key ID; returns ciphertext. Used to encrypt small values like passwords or tokens directly.
- **`Decrypt`** — Takes ciphertext; KMS identifies the key from the ciphertext metadata and returns the original plaintext. You don't specify the key — KMS resolves it.
- **`GenerateDataKey`** — Returns both a **plaintext data key** and an **encrypted copy of that same data key**. Used for envelope encryption (see below). The plaintext key is used immediately to encrypt data, then discarded from memory.
- **`GenerateDataKeyWithoutPlaintext`** — Returns only the encrypted data key. Used when you want to generate and store a key for later use, without having the plaintext key available right now.

### Envelope Encryption — Understand This Deeply

Encrypting large amounts of data directly with KMS isn't practical — the API has a 4 KB limit on plaintext input, and sending all your data over the network to KMS for encryption would be slow and expensive.

**Envelope encryption** solves this by using two layers of keys:

1. KMS holds a **Key Encryption Key (KEK)** — your CMK. It never leaves KMS.
2. Your application generates (or requests via `GenerateDataKey`) a short-lived **Data Encryption Key (DEK)**, which is a plain AES key used locally to encrypt your actual data.
3. The plaintext DEK is used to encrypt the data, then immediately discarded. The **encrypted DEK** (wrapped by the CMK) is stored alongside the encrypted data.

To decrypt later:
1. Send the encrypted DEK to KMS (`Decrypt`).
2. KMS returns the plaintext DEK.
3. Use the plaintext DEK locally to decrypt your data.

This pattern means your actual data is never sent to KMS, and the DEK is never stored in plaintext. AWS SDKs and services like S3-SSE-KMS implement this pattern transparently — understanding it tells you *why* services make `GenerateDataKey` calls and what the encrypted key metadata stored with your objects is for [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping).

### Key Rotation

For Customer Managed Keys, you can enable **automatic key rotation** — KMS rotates the key material annually while keeping the same key ID [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html). Crucially, old key material is retained so that data encrypted before the rotation can still be decrypted. From your application's perspective, nothing changes — the key ID stays the same.

**Manual rotation** means creating a new CMK entirely and updating your application or alias to point to it. This is necessary for asymmetric keys (which don't support automatic rotation) or when you need to rotate on your own schedule. Using **key aliases** (friendly names like `alias/my-app-key`) makes manual rotation easier since you update the alias target rather than every reference to the key ID [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/kms-alias.html).

AWS Managed Keys rotate automatically every year and require no action from you.

### KMS Multi-Region Keys

By default, KMS keys are regional — a key in `us-east-1` cannot be used directly in `eu-west-1`. **Multi-Region Keys** are a set of interoperable keys with the same key material and key ID prefix, replicated across multiple AWS regions [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html).

The practical benefit: data encrypted in one region can be decrypted in another without cross-region API calls or re-encryption. This is useful for globally distributed applications, disaster recovery scenarios, and active-active multi-region architectures. Multi-Region Keys still have a primary key and one or more replicas — replication is explicit, not automatic.

### Encryption Across Account Boundaries

A common pattern is allowing a resource in **Account B** to use a CMK in **Account A** — for example, an EC2 instance in Account B encrypting snapshots with Account A's key.

This requires two things, both of which must be in place:
1. The **KMS key policy** in Account A must explicitly allow Account B's principal (or its root) to use the key.
2. An **IAM policy** in Account B must allow the principal to call the relevant KMS actions.

Neither alone is sufficient — this is the same dual-control model that governs cross-account S3 bucket access [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-modifying-external-accounts.html).

> **A note on costs**: Each Customer Managed Key costs $1/month. API calls beyond the free tier are charged per 10,000 requests. This isn't prohibitive, but it's worth understanding why services that call `GenerateDataKey` frequently (like S3 with many small objects) can accumulate KMS API costs — and why **S3 Bucket Keys** exist to reduce those calls [🔗](https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucket-key.html).