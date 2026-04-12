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

{{< qcm >}}
[
{
"question": "A developer needs to encrypt a 6 MB file using AWS KMS. What is the recommended approach?",
"answers": [
{
"answer": "Call the KMS Encrypt API directly with the file content.",
"isCorrect": false,
"explanation": "The KMS Encrypt API only supports plaintext up to 4 KB. A 6 MB file cannot be passed directly to this API."
},
{
"answer": "Use envelope encryption: call GenerateDataKey to get a plaintext data key, encrypt the file locally with that key, then store the encrypted data key alongside the encrypted file.",
"isCorrect": true,
"explanation": "Envelope encryption is the correct pattern for encrypting data larger than 4 KB. The data key encrypts the file locally without sending the file to KMS, and the encrypted data key is stored with the file for later decryption."
},
{
"answer": "Split the file into 4 KB chunks and call KMS Encrypt on each chunk.",
"isCorrect": false,
"explanation": "While technically possible, this approach is inefficient, expensive, and not the recommended pattern. Envelope encryption is the standard solution for large data."
},
{
"answer": "Call GenerateDataKeyWithoutPlaintext, then use the returned encrypted key to encrypt the file locally.",
"isCorrect": false,
"explanation": "GenerateDataKeyWithoutPlaintext returns only the encrypted data key — no plaintext key is returned. You cannot use the encrypted key directly to encrypt data; you would first need to decrypt it via KMS to get the plaintext key."
}
]
},
{
"question": "When decrypting data using the KMS Decrypt API, which of the following is true?",
"answers": [
{
"answer": "You must specify the key ID to tell KMS which key to use for decryption.",
"isCorrect": false,
"explanation": "The Decrypt API does not require you to specify a key ID. KMS automatically identifies the correct key from the metadata embedded in the ciphertext."
},
{
"answer": "KMS resolves the key automatically from the ciphertext metadata.",
"isCorrect": true,
"explanation": "When KMS encrypts data, it embeds key metadata in the ciphertext. The Decrypt API uses this metadata to identify and use the correct key automatically — no key ID is needed in the request."
},
{
"answer": "You must pass the original plaintext data key along with the ciphertext.",
"isCorrect": false,
"explanation": "The Decrypt API only takes ciphertext as input. Passing a plaintext data key is not part of the API and would defeat the purpose of encryption."
}
]
},
{
"question": "A company wants to allow an IAM role in Account B to use a Customer Managed Key (CMK) stored in Account A. What is required to make this work? (Select TWO)",
"answers": [
{
"answer": "The KMS key policy in Account A must explicitly grant access to Account B's principal.",
"isCorrect": true,
"explanation": "For cross-account key usage, the key policy in the owning account must explicitly allow the external principal. KMS uses a dual-control model — neither the key policy nor the IAM policy alone is sufficient."
},
{
"answer": "An IAM policy in Account B must allow the principal to call the relevant KMS actions.",
"isCorrect": true,
"explanation": "Even if the key policy in Account A grants access, the IAM policy in Account B must also permit the KMS calls. Both controls are required simultaneously."
},
{
"answer": "The CMK must be converted to an AWS Managed Key to support cross-account access.",
"isCorrect": false,
"explanation": "Cross-account access is a feature of Customer Managed Keys, not AWS Managed Keys. AWS Managed Keys cannot be shared across accounts."
},
{
"answer": "A KMS grant must be created in Account A pointing to Account B.",
"isCorrect": false,
"explanation": "Grants are one mechanism for delegating key access, but they are not required for cross-account access. Updating the key policy is the standard approach. Both an updated key policy and an IAM policy in Account B are necessary."
}
]
},
{
"question": "What is the difference between GenerateDataKey and GenerateDataKeyWithoutPlaintext?",
"answers": [
{
"answer": "GenerateDataKey returns both a plaintext and an encrypted data key; GenerateDataKeyWithoutPlaintext returns only the encrypted data key.",
"isCorrect": true,
"explanation": "GenerateDataKey is used when you need to encrypt data immediately — you use the plaintext key, then discard it. GenerateDataKeyWithoutPlaintext is used when you want to store an encrypted key for future use without exposing the plaintext key now."
},
{
"answer": "GenerateDataKey creates a symmetric key; GenerateDataKeyWithoutPlaintext creates an asymmetric key.",
"isCorrect": false,
"explanation": "Both API calls generate symmetric data keys. The difference is in whether the plaintext version of the key is returned, not in the key type."
},
{
"answer": "GenerateDataKeyWithoutPlaintext is used for envelope encryption; GenerateDataKey is not.",
"isCorrect": false,
"explanation": "Both calls are used in envelope encryption contexts. GenerateDataKey is actually the primary call used in the standard envelope encryption flow where you need to immediately encrypt data."
}
]
},
{
"question": "A developer enables automatic key rotation on a Customer Managed Key (CMK). Which of the following statements accurately describes the behavior?",
"answers": [
{
"answer": "The key material is rotated annually, but the key ID remains the same.",
"isCorrect": true,
"explanation": "Automatic rotation changes the underlying cryptographic material each year while preserving the key ID, alias, and ARN. Applications referencing the key ID do not need to be updated."
},
{
"answer": "A new CMK is created with a new key ID, and the old key is deleted.",
"isCorrect": false,
"explanation": "This describes manual rotation, not automatic rotation. Automatic rotation keeps the same key ID and retains old key material to allow decryption of previously encrypted data."
},
{
"answer": "Data encrypted before the rotation can no longer be decrypted after rotation occurs.",
"isCorrect": false,
"explanation": "Old key material is retained after rotation. KMS tracks which key material version was used for encryption and uses the correct version for decryption, so existing data remains accessible."
},
{
"answer": "Old key material is retained so data encrypted before rotation can still be decrypted.",
"isCorrect": true,
"explanation": "KMS keeps all previous key material versions when rotating. This ensures backward compatibility — data encrypted with any prior version of the key can still be decrypted."
}
]
},
{
"question": "Which type of KMS key requires manual rotation, as automatic rotation is not supported?",
"answers": [
{
"answer": "Customer Managed Keys (symmetric)",
"isCorrect": false,
"explanation": "Symmetric CMKs support automatic annual key rotation when the feature is enabled."
},
{
"answer": "AWS Managed Keys",
"isCorrect": false,
"explanation": "AWS Managed Keys are rotated automatically by AWS every year. You have no ability to trigger manual rotation for them."
},
{
"answer": "Asymmetric Customer Managed Keys",
"isCorrect": true,
"explanation": "Asymmetric CMKs do not support automatic key rotation. If rotation is needed, you must create a new CMK and update references (typically via a key alias) to point to the new key."
}
]
},
{
"question": "An application uses a KMS key alias (alias/my-app-key) instead of the key ID directly. The team decides to rotate the key manually by creating a new CMK. What must they do to complete the rotation without updating the application code?",
"answers": [
{
"answer": "Update the alias target to point to the new CMK.",
"isCorrect": true,
"explanation": "Key aliases are pointers to CMKs. By updating the alias to target the new CMK, all references to alias/my-app-key automatically resolve to the new key — no application code changes are needed."
},
{
"answer": "Delete the old CMK immediately after creating the new one.",
"isCorrect": false,
"explanation": "Deleting the old CMK would make it impossible to decrypt data that was encrypted with it. The old key must be retained until all data encrypted with it has been re-encrypted or is no longer needed."
},
{
"answer": "Update every IAM policy and key policy that references the old key ID.",
"isCorrect": false,
"explanation": "Because the application uses an alias rather than a direct key ID, changing the alias target is sufficient. Policies referencing the alias will resolve to the new key automatically."
}
]
},
{
"question": "What is the primary access control mechanism for a KMS Customer Managed Key?",
"answers": [
{
"answer": "IAM policies attached to the calling principal",
"isCorrect": false,
"explanation": "IAM policies alone are not sufficient for KMS access. Unlike most AWS resources, KMS requires the key policy to explicitly grant access. An IAM policy without a corresponding key policy entry will not work."
},
{
"answer": "The key policy attached to the KMS key itself",
"isCorrect": true,
"explanation": "Every KMS key has a resource-based key policy that is the primary access control mechanism. The key policy must explicitly allow principals to use or administer the key. IAM policies can supplement but not replace the key policy."
},
{
"answer": "KMS grants assigned to principals",
"isCorrect": false,
"explanation": "Grants are a valid programmatic mechanism for delegating key access, but they are not the primary access control mechanism. The key policy is the foundational control; grants are used for temporary or service-driven delegation."
}
]
},
{
"question": "A developer is building a multi-region application and needs to decrypt in eu-west-1 data that was encrypted in us-east-1 using KMS. What is the most efficient solution?",
"answers": [
{
"answer": "Use a KMS Multi-Region Key so the same key material is available in both regions.",
"isCorrect": true,
"explanation": "Multi-Region Keys replicate the same key material across regions, allowing data encrypted in one region to be decrypted in another without cross-region API calls or re-encryption. This is the purpose-built solution for this use case."
},
{
"answer": "Decrypt the data in us-east-1, transfer the plaintext to eu-west-1, and re-encrypt with a regional key.",
"isCorrect": false,
"explanation": "This approach requires moving plaintext data across regions, which introduces security risk and operational complexity. Multi-Region Keys solve this more cleanly."
},
{
"answer": "Copy the CMK from us-east-1 to eu-west-1 using the KMS export feature.",
"isCorrect": false,
"explanation": "KMS does not provide a generic key export feature. Multi-Region Keys are the supported mechanism for using the same key material across regions."
}
]
},
{
"question": "Which of the following statements about AWS Owned Keys is correct?",
"answers": [
{
"answer": "They are visible in your AWS account under the KMS console.",
"isCorrect": false,
"explanation": "AWS Owned Keys are fully internal to AWS and are not visible in your account. You have no visibility into or control over them."
},
{
"answer": "You can view them but cannot rotate them manually.",
"isCorrect": false,
"explanation": "This describes AWS Managed Keys, not AWS Owned Keys. AWS Owned Keys are invisible to customers entirely."
},
{
"answer": "They are fully managed by AWS, invisible to customers, and used across multiple accounts for baseline encryption.",
"isCorrect": true,
"explanation": "AWS Owned Keys are internal AWS keys used to provide baseline encryption for some services. Customers have no visibility into or control over these keys."
}
]
},
{
"question": "An S3 bucket is configured with SSE-KMS encryption. The number of objects uploaded is very high, causing significant KMS API costs. What AWS feature can reduce these costs?",
"answers": [
{
"answer": "Switch to AWS Managed Keys, which have no per-request charges.",
"isCorrect": false,
"explanation": "AWS Managed Keys are still subject to KMS API request charges. Switching key types does not reduce the number of GenerateDataKey calls made per object."
},
{
"answer": "Enable S3 Bucket Keys to reduce the number of KMS API calls.",
"isCorrect": true,
"explanation": "S3 Bucket Keys generate a short-lived data key at the bucket level that is used to encrypt many objects, dramatically reducing the number of individual GenerateDataKey calls to KMS and therefore lowering API costs."
},
{
"answer": "Use envelope encryption manually in the application instead of SSE-KMS.",
"isCorrect": false,
"explanation": "SSE-KMS already uses envelope encryption internally. Implementing it manually would add complexity without addressing the root cause, which is the high volume of KMS API calls per object."
}
]
},
{
"question": "In envelope encryption, what happens to the plaintext data key after the data has been encrypted?",
"answers": [
{
"answer": "It is stored encrypted alongside the data for future use.",
"isCorrect": false,
"explanation": "The encrypted data key (not the plaintext key) is stored alongside the data. The plaintext data key is discarded from memory immediately after encryption."
},
{
"answer": "It is sent to KMS for secure storage.",
"isCorrect": false,
"explanation": "The plaintext data key never goes to KMS for storage. Only the CMK (Key Encryption Key) resides in KMS. The plaintext DEK is used locally and discarded."
},
{
"answer": "It is discarded from memory immediately after encrypting the data.",
"isCorrect": true,
"explanation": "This is a core security property of envelope encryption. The plaintext DEK is used to encrypt data locally, then immediately discarded. Only the encrypted DEK (wrapped by the CMK) is persisted, ensuring the plaintext key is never stored."
}
]
},
{
"question": "A KMS key policy has a section for 'key administrators' and a section for 'key users'. Which of the following correctly describes the distinction?",
"answers": [
{
"answer": "Key administrators can perform cryptographic operations; key users can only manage the key lifecycle.",
"isCorrect": false,
"explanation": "This is reversed. Key users are authorized for cryptographic operations (Encrypt, Decrypt, etc.), while key administrators manage the key lifecycle (policy updates, enable/disable, schedule deletion) but are not necessarily authorized for cryptographic use."
},
{
"answer": "Key administrators manage the key (update policy, enable/disable, schedule deletion) but do not necessarily have cryptographic access; key users can call cryptographic API actions.",
"isCorrect": true,
"explanation": "The key policy separates management permissions from usage permissions. An administrator can control the key's configuration without being able to encrypt or decrypt data, and vice versa."
},
{
"answer": "There is no functional difference — both sections grant the same permissions.",
"isCorrect": false,
"explanation": "The two sections grant distinct permissions. Conflating them would violate the principle of least privilege and is not how KMS key policies are structured."
}
]
},
{
"question": "What is a KMS Grant, and when would you use one?",
"answers": [
{
"answer": "A grant is a permanent key policy statement used to give an IAM role access to a CMK.",
"isCorrect": false,
"explanation": "Grants are not permanent policy statements — they are programmatic, temporary delegations of key access. Permanent access is typically configured in the key policy itself."
},
{
"answer": "A grant is a programmatic mechanism to delegate key usage to a principal or AWS service temporarily, without modifying the key policy.",
"isCorrect": true,
"explanation": "Grants allow fine-grained, temporary delegation of key access. AWS services like EBS use grants to access CMKs on behalf of a customer without requiring key policy modifications every time."
},
{
"answer": "A grant is used to replicate a CMK across AWS regions.",
"isCorrect": false,
"explanation": "Replicating keys across regions is achieved with KMS Multi-Region Keys, not grants. Grants are about access delegation, not key replication."
}
]
},
{
"question": "A developer calls GenerateDataKey using a CMK. Which of the following correctly describes what is returned?",
"answers": [
{
"answer": "Only the encrypted data key, which must be decrypted before use.",
"isCorrect": false,
"explanation": "This describes GenerateDataKeyWithoutPlaintext. GenerateDataKey returns both a plaintext data key (for immediate use) and the encrypted data key (for storage)."
},
{
"answer": "A plaintext data key and an encrypted copy of that same data key.",
"isCorrect": true,
"explanation": "GenerateDataKey returns two forms of the same key: the plaintext version for immediate use to encrypt data, and the encrypted version (wrapped by the CMK) to store alongside the encrypted data."
},
{
"answer": "The CMK itself in plaintext form for local use.",
"isCorrect": false,
"explanation": "The CMK (Key Encryption Key) never leaves KMS. GenerateDataKey produces a separate, short-lived data key — it does not expose the CMK."
}
]
}
]
{{< /qcm >}}