---
title: "28. KMS"
type: docs
weight: 1
---

## KMS (Key Management Service) — Deep Dive

AWS Key Management Service (KMS) is a managed service that lets you create, control, and use cryptographic keys to protect your data. Its core purpose is simple: rather than managing raw encryption keys yourself — which is error-prone and operationally burdensome — KMS centralises key management, enforces access control via IAM and key policies, and maintains an audit trail through CloudTrail. Every call to KMS is logged, which makes it the default choice for encryption across nearly every AWS service.

By this point in the course you have already encountered KMS in several contexts: SSE-KMS in S3, DynamoDB encryption at rest, SQS message encryption, and Lambda environment variable encryption. This section pulls all of that together and fills in the underlying mechanics.

### Envelope Encryption — The Core Pattern

KMS does not encrypt your data directly in most real-world scenarios. Instead, it uses **envelope encryption** [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#enveloping), a two-layer pattern:

1. KMS generates a **Data Encryption Key (DEK)** — a short-lived symmetric key used to encrypt your actual data locally.
2. KMS then encrypts the DEK itself using your **KMS key** (the root key, which never leaves KMS).
3. The encrypted DEK is stored alongside the ciphertext. The plaintext DEK is discarded immediately after use.

To decrypt, the process reverses: KMS decrypts the encrypted DEK using the KMS key, and your application uses the plaintext DEK to decrypt the data locally.

This pattern explains why KMS can protect arbitrarily large payloads without sending them to the KMS API — only the small DEK crosses the wire. It also explains the cost model: you pay per KMS API call (GenerateDataKey, Decrypt), not per byte of data encrypted.

**How this maps to services you have already seen:**

- **S3 with SSE-KMS** — When you upload an object, S3 calls `GenerateDataKey` on your behalf, encrypts the object locally with the DEK, stores the encrypted DEK in object metadata, and discards the plaintext DEK. On download, S3 calls `Decrypt` to recover the DEK. This is why SSE-KMS has a cost and a KMS API rate limit consideration that SSE-S3 does not.
- **DynamoDB** — Encryption at rest uses a table-level KMS key. DynamoDB manages the DEK lifecycle internally; you choose the key (AWS-owned, AWS-managed, or customer-managed).
- **SQS** — Server-side encryption for queues follows the same pattern. Each message batch is encrypted with a DEK derived from the queue's KMS key.
- **Lambda environment variables** — Lambda encrypts environment variables at rest using a KMS key. You can bring your own CMK for additional control over key rotation and access.

### KMS Key Types

KMS keys differ along two axes — who creates them and who manages them [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html#key-mgmt):

- **AWS-owned keys** — Created and managed entirely by AWS, used internally by services like S3 (SSE-S3) and DynamoDB (AWS-owned option). You have no visibility or control, and they appear in no key list in your account.
- **AWS-managed keys** — Created in your account automatically when you first enable encryption for a service (e.g., `aws/s3`, `aws/lambda`). You can see them in the KMS console and view CloudTrail logs, but you cannot rotate, delete, or modify their key policies.
- **Customer-managed keys (CMKs)** — Keys you create explicitly. These give you full control: custom key policies, manual or automatic annual rotation, grants, cross-account access, and the ability to disable or schedule deletion. CMKs are what you use when compliance, auditability, or cross-account sharing is a requirement.

For the exam, the practical distinction is: **CMKs are required whenever you need to share encrypted resources across accounts, enforce fine-grained key policies, or control rotation yourself.**

### Key Policies and Access Control

Every KMS key has a **key policy** — a resource-based policy that is the primary access control mechanism [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html). Unlike most AWS resources where IAM policies alone suffice, KMS requires that the key policy explicitly allows access. IAM policies alone are not sufficient unless the key policy delegates trust to the account's IAM system.

The default key policy when you create a CMK grants the root account full access and allows IAM policies to control access further. A common exam scenario: a developer cannot use a CMK even with the correct IAM permissions — the fix is to check whether the key policy grants their principal (or their role) access.

**Grants** are an alternative mechanism [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/grants.html) — programmatic, temporary delegations of key permissions. AWS services like EBS and RDS use grants internally when they need to use your CMK on your behalf.

### Automatic Key Rotation

For CMKs, you can enable **automatic rotation** [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html), which causes KMS to generate new cryptographic material every year while retaining the old material to decrypt data encrypted under previous versions. The key ID and ARN do not change, so no application changes are needed. AWS-managed keys rotate automatically every year; you cannot disable this.

### CloudHSM — Dedicated Hardware Security Modules

AWS CloudHSM [🔗](https://docs.aws.amazon.com/cloudhsm/latest/userguide/introduction.html) provides **dedicated, single-tenant hardware security modules** running in your VPC. The fundamental difference from KMS is the tenancy model and the compliance level:

| | KMS | CloudHSM |
|---|---|---|
| Hardware tenancy | Shared (multi-tenant) | Dedicated (single-tenant) |
| FIPS 140-2 level | Level 2 (overall) | **Level 3** |
| Key ownership | AWS manages the HSM; you manage the keys | You manage both the HSM and the keys |
| Integration | Native to almost all AWS services | Manual — you integrate via PKCS#11, JCE, or Microsoft CNG |
| Pricing model | Per API call | Per HSM-hour (plus cluster overhead) |
| Operational burden | Low — fully managed | High — you are responsible for HA clustering, backups |

**When to choose CloudHSM:** regulatory requirements that mandate FIPS 140-2 Level 3, use cases that require you to control the HSM's root of trust entirely (AWS has no access to CloudHSM keys), or workloads that need to use industry-standard cryptographic APIs (PKCS#11) rather than the KMS API.

**When to choose KMS:** virtually everything else. KMS is sufficient for most compliance frameworks, integrates natively with AWS services, and requires no operational management. For the exam, CloudHSM appears mostly in scenarios that explicitly mention FIPS 140-2 Level 3, dedicated hardware, or customer-controlled HSM credentials.

Note that KMS and CloudHSM are not mutually exclusive — you can configure a KMS **custom key store** [🔗](https://docs.aws.amazon.com/kms/latest/developerguide/custom-key-store-overview.html) backed by a CloudHSM cluster, which lets you use the familiar KMS API while keeping key material in your dedicated HSM.

{{< qcm >}}
[
{
"question": "A developer is uploading large files to S3 using SSE-KMS. Which of the following accurately describes what happens during the encryption process?",
"answers": [
{
"answer": "S3 sends the entire object to KMS for encryption.",
"isCorrect": false,
"explanation": "KMS never receives the raw data. Only the Data Encryption Key (DEK) crosses the wire to/from KMS, not the actual object content."
},
{
"answer": "S3 calls GenerateDataKey to obtain a DEK, encrypts the object locally, stores the encrypted DEK in object metadata, and discards the plaintext DEK.",
"isCorrect": true,
"explanation": "This is the envelope encryption pattern. S3 uses the plaintext DEK to encrypt the object locally, then stores only the encrypted DEK alongside the object. The plaintext DEK is immediately discarded."
},
{
"answer": "S3 uses the KMS key ARN directly to encrypt the object without generating an intermediate key.",
"isCorrect": false,
"explanation": "KMS keys (root keys) never leave KMS. S3 always uses envelope encryption: a short-lived DEK is generated to encrypt the data locally, and only the DEK is encrypted by the KMS key."
},
{
"answer": "On download, S3 calls Decrypt to recover the plaintext DEK, then uses it to decrypt the object locally.",
"isCorrect": true,
"explanation": "This is the decryption side of the envelope encryption pattern. S3 passes the encrypted DEK to KMS, receives the plaintext DEK, decrypts the object locally, and discards the plaintext DEK again."
}
]
},
{
"question": "Which of the following explains why envelope encryption is used instead of sending all data directly to KMS for encryption?",
"answers": [
{
"answer": "KMS can only encrypt data up to 4 KB in size.",
"isCorrect": true,
"explanation": "The KMS API has a 4 KB limit on data it can encrypt directly. Envelope encryption solves this by having KMS encrypt only the small DEK, while the actual data is encrypted locally — allowing arbitrarily large payloads to be protected."
},
{
"answer": "Sending large data to KMS would increase costs significantly since billing is per byte.",
"isCorrect": false,
"explanation": "KMS billing is per API call (e.g., GenerateDataKey, Decrypt), not per byte. While cost is a benefit of envelope encryption, the primary reason is the 4 KB API limit, not a per-byte pricing model."
},
{
"answer": "Encrypting data locally avoids sending sensitive plaintext over the network to KMS.",
"isCorrect": true,
"explanation": "With envelope encryption, the raw data never leaves the local environment. Only the small DEK is exchanged with KMS, which is a meaningful security benefit in addition to bypassing the 4 KB limit."
},
{
"answer": "CloudTrail cannot log operations on data larger than 4 KB.",
"isCorrect": false,
"explanation": "CloudTrail log size has nothing to do with the use of envelope encryption. CloudTrail logs KMS API calls regardless of data size."
}
]
},
{
"question": "A company needs to share a KMS-encrypted S3 object with another AWS account. What type of KMS key must be used?",
"answers": [
{
"answer": "AWS-owned key",
"isCorrect": false,
"explanation": "AWS-owned keys are not visible or configurable in your account. You cannot grant cross-account access to them."
},
{
"answer": "AWS-managed key (e.g., aws/s3)",
"isCorrect": false,
"explanation": "AWS-managed keys are created in your account but you cannot modify their key policies, so you cannot grant access to external accounts."
},
{
"answer": "Customer-managed key (CMK)",
"isCorrect": true,
"explanation": "CMKs support custom key policies that can grant cross-account access. This is required for sharing encrypted resources across AWS accounts."
}
]
},
{
"question": "A developer has the correct IAM permissions to use a customer-managed KMS key, but their API calls are still being denied. What is the most likely cause?",
"answers": [
{
"answer": "The KMS key has been automatically rotated and the old key ID is no longer valid.",
"isCorrect": false,
"explanation": "Key rotation in KMS does not change the key ID or ARN. The same key ID continues to work after rotation, so this would not cause a denial."
},
{
"answer": "The key policy does not explicitly grant access to the developer's IAM principal or role.",
"isCorrect": true,
"explanation": "KMS requires explicit access grants in the key policy. Unlike most AWS resources, IAM policies alone are insufficient unless the key policy delegates trust to the account's IAM system. The key policy is the primary and required access control mechanism."
},
{
"answer": "CMKs can only be used by the root account by default.",
"isCorrect": false,
"explanation": "While the default key policy grants the root account full access, CMKs can be used by any principal explicitly allowed in the key policy. The issue here is a missing key policy entry, not a root-only restriction."
},
{
"answer": "The developer must use grants instead of IAM policies to access CMKs.",
"isCorrect": false,
"explanation": "Grants are an alternative mechanism but not a requirement. IAM policies combined with an appropriate key policy can grant access. The issue is the missing key policy entry."
}
]
},
{
"question": "Which statement about AWS-managed KMS keys is correct?",
"answers": [
{
"answer": "They are created automatically when you enable encryption for a supported AWS service.",
"isCorrect": true,
"explanation": "AWS-managed keys (e.g., aws/s3, aws/lambda) are automatically created in your account the first time you use encryption for a given service."
},
{
"answer": "You can modify their key policies to grant cross-account access.",
"isCorrect": false,
"explanation": "AWS-managed keys do not allow modification of key policies. You cannot rotate, delete, or change their policies. CMKs are required for cross-account access."
},
{
"answer": "They rotate automatically every year and this cannot be disabled.",
"isCorrect": true,
"explanation": "AWS-managed keys are rotated automatically every year by AWS. This behavior cannot be disabled, unlike CMKs where rotation is optional and configurable."
},
{
"answer": "They are invisible in the KMS console and cannot be audited in CloudTrail.",
"isCorrect": false,
"explanation": "AWS-managed keys are visible in the KMS console, and their usage is logged in CloudTrail. It is AWS-owned keys (not AWS-managed keys) that are completely invisible to the account."
}
]
},
{
"question": "What happens to the key ID and ARN of a customer-managed KMS key when automatic rotation is enabled and a rotation occurs?",
"answers": [
{
"answer": "The key ID and ARN remain the same; only the underlying cryptographic material changes.",
"isCorrect": true,
"explanation": "KMS key rotation is transparent to applications. The key ID and ARN stay the same, so no code or configuration changes are needed. KMS retains old cryptographic material to decrypt data encrypted under previous key versions."
},
{
"answer": "A new key ID and ARN are generated; the application must be updated to use the new ARN.",
"isCorrect": false,
"explanation": "This is a common misconception. KMS rotation does not change the key ID or ARN. The key identity is preserved; only the backing cryptographic material is rotated."
},
{
"answer": "Old cryptographic material is deleted immediately after rotation.",
"isCorrect": false,
"explanation": "KMS retains all previous cryptographic material after rotation. This is necessary to decrypt data that was encrypted under earlier versions of the key."
}
]
},
{
"question": "An application needs to encrypt environment variables in an AWS Lambda function using a key that allows custom rotation schedules and fine-grained access control. Which key type should be used?",
"answers": [
{
"answer": "AWS-owned key",
"isCorrect": false,
"explanation": "AWS-owned keys offer no visibility or control. You cannot customize rotation schedules or access policies for them."
},
{
"answer": "AWS-managed key (aws/lambda)",
"isCorrect": false,
"explanation": "AWS-managed keys rotate automatically every year but you cannot customize the rotation schedule or key policy. They do not support fine-grained access control."
},
{
"answer": "Customer-managed key (CMK)",
"isCorrect": true,
"explanation": "CMKs give you full control, including custom key policies for fine-grained access control and the ability to manage rotation. This is the correct choice when compliance or auditability requirements demand it."
}
]
},
{
"question": "A solutions architect must choose between AWS KMS and AWS CloudHSM for a workload that requires FIPS 140-2 Level 3 validation and dedicated hardware. Which service should be selected?",
"answers": [
{
"answer": "AWS KMS, because it is FIPS 140-2 Level 3 certified.",
"isCorrect": false,
"explanation": "KMS achieves FIPS 140-2 Level 2 overall, not Level 3. If Level 3 is a hard regulatory requirement, KMS alone does not satisfy it."
},
{
"answer": "AWS CloudHSM, because it provides dedicated single-tenant HSMs validated at FIPS 140-2 Level 3.",
"isCorrect": true,
"explanation": "CloudHSM uses dedicated, single-tenant hardware validated at FIPS 140-2 Level 3 — the highest level available on AWS. This is the correct choice when regulations explicitly mandate Level 3 or dedicated hardware."
},
{
"answer": "AWS KMS with a custom key store backed by CloudHSM, which upgrades KMS to FIPS 140-2 Level 3.",
"isCorrect": false,
"explanation": "While a KMS custom key store backed by CloudHSM allows using the KMS API with key material stored in a CloudHSM cluster, it is the CloudHSM component providing the Level 3 guarantee. The requirement for dedicated hardware and Level 3 points directly to CloudHSM itself."
}
]
},
{
"question": "Which of the following are correct differences between AWS KMS and AWS CloudHSM? (Select TWO)",
"answers": [
{
"answer": "KMS uses shared (multi-tenant) hardware, while CloudHSM provides dedicated single-tenant HSMs.",
"isCorrect": true,
"explanation": "This is the fundamental tenancy difference. KMS runs on shared infrastructure managed by AWS; CloudHSM gives each customer their own dedicated HSM hardware."
},
{
"answer": "CloudHSM integrates natively with most AWS services (S3, DynamoDB, RDS) without additional configuration.",
"isCorrect": false,
"explanation": "CloudHSM requires manual integration via standard APIs like PKCS#11, JCE, or Microsoft CNG. It does not have native integration with most AWS services — that is KMS's advantage."
},
{
"answer": "With CloudHSM, AWS has no access to the keys stored in the HSM.",
"isCorrect": true,
"explanation": "CloudHSM is fully customer-controlled. AWS manages the hardware infrastructure but has no visibility into or access to the cryptographic keys. This is a key distinction from KMS, where AWS manages the HSM fleet."
},
{
"answer": "KMS charges per HSM-hour, while CloudHSM charges per API call.",
"isCorrect": false,
"explanation": "This is reversed. KMS charges per API call (e.g., per GenerateDataKey or Decrypt request), while CloudHSM charges per HSM-hour plus cluster overhead."
}
]
},
{
"question": "An SQS queue is configured with server-side encryption using a customer-managed KMS key. A Lambda function that processes messages from the queue is failing with a KMS access denied error. What should be checked first?",
"answers": [
{
"answer": "Whether the SQS queue's visibility timeout is longer than the KMS key's rotation period.",
"isCorrect": false,
"explanation": "Key rotation period and queue visibility timeout are unrelated. Rotation does not invalidate existing access or cause API errors."
},
{
"answer": "Whether the Lambda function's execution role has IAM permissions to call kms:Decrypt, and whether the KMS key policy grants access to that role.",
"isCorrect": true,
"explanation": "For a Lambda function to decrypt SQS messages, its execution role needs both IAM permissions (kms:Decrypt) and explicit access in the CMK's key policy. A denial typically means one or both of these is missing."
},
{
"answer": "Whether the KMS key is in the same Availability Zone as the SQS queue.",
"isCorrect": false,
"explanation": "KMS is a regional service, not AZ-scoped. There is no AZ affinity requirement between KMS keys and SQS queues."
},
{
"answer": "Whether the KMS key needs to be replaced with an AWS-managed key to work with SQS.",
"isCorrect": false,
"explanation": "SQS supports customer-managed keys. Switching to an AWS-managed key would actually reduce control. The issue is an access policy misconfiguration, not a key type incompatibility."
}
]
},
{
"question": "What is the purpose of KMS Grants?",
"answers": [
{
"answer": "They are permanent key policy additions used to replace the default key policy.",
"isCorrect": false,
"explanation": "Grants are programmatic and temporary delegations, not permanent policy replacements. They are typically used by AWS services acting on your behalf, not as substitutes for key policies."
},
{
"answer": "They allow programmatic, temporary delegation of key permissions to other principals, commonly used by AWS services like EBS and RDS.",
"isCorrect": true,
"explanation": "Grants let AWS services (like EBS or RDS) use your CMK on your behalf without modifying the key policy. They are temporary and can be retired when no longer needed."
},
{
"answer": "They enable cross-region replication of KMS keys.",
"isCorrect": false,
"explanation": "KMS key replication across regions is handled by multi-region keys, not grants. Grants are strictly an access delegation mechanism."
}
]
},
{
"question": "A developer wants to use the KMS API for key management but must keep all key material within dedicated hardware for compliance reasons. Which architecture satisfies both requirements?",
"answers": [
{
"answer": "Use a standard CMK in KMS with automatic rotation enabled.",
"isCorrect": false,
"explanation": "Standard CMKs store key material in KMS's shared (multi-tenant) HSMs. This does not meet the dedicated hardware requirement."
},
{
"answer": "Use a KMS custom key store backed by a CloudHSM cluster.",
"isCorrect": true,
"explanation": "A KMS custom key store allows you to use the familiar KMS API while the actual key material is stored in your dedicated CloudHSM cluster. This satisfies both the API familiarity and the dedicated hardware compliance requirement."
},
{
"answer": "Use CloudHSM directly with the KMS API by referencing the CloudHSM ARN in KMS calls.",
"isCorrect": false,
"explanation": "You cannot directly reference a CloudHSM cluster in standard KMS API calls. The integration requires configuring a KMS custom key store linked to the CloudHSM cluster."
}
]
},
{
"question": "Which of the following actions are logged by AWS CloudTrail when using KMS? (Select TWO)",
"answers": [
{
"answer": "GenerateDataKey API calls made by S3 on behalf of a user uploading an SSE-KMS encrypted object.",
"isCorrect": true,
"explanation": "Every KMS API call, including GenerateDataKey invoked by S3 during an upload, is recorded in CloudTrail. This is one of the key auditability benefits of KMS over SSE-S3."
},
{
"answer": "The plaintext content of the Data Encryption Key generated during the request.",
"isCorrect": false,
"explanation": "CloudTrail logs KMS API call metadata (who called, when, which key, result), but never the plaintext cryptographic material itself. Key material is never exposed in logs."
},
{
"answer": "Decrypt API calls made when a Lambda function decrypts its environment variables.",
"isCorrect": true,
"explanation": "Any call to the KMS Decrypt operation — including those triggered by Lambda decrypting environment variables — is captured in CloudTrail, providing a full audit trail."
},
{
"answer": "The size in bytes of each object encrypted using SSE-KMS in S3.",
"isCorrect": false,
"explanation": "CloudTrail logs KMS API calls, not S3 object metadata like size. The object size does not appear in KMS-related CloudTrail entries."
}
]
},
{
"question": "A DynamoDB table is configured with encryption at rest using a customer-managed KMS key. Which of the following correctly describes how encryption is managed?",
"answers": [
{
"answer": "Each DynamoDB item is individually sent to KMS for encryption on every write.",
"isCorrect": false,
"explanation": "DynamoDB does not send individual items to KMS for encryption. It uses envelope encryption — DynamoDB manages DEK lifecycles internally and only interacts with KMS to wrap/unwrap the DEK."
},
{
"answer": "DynamoDB uses table-level KMS key configuration and manages the DEK lifecycle internally using envelope encryption.",
"isCorrect": true,
"explanation": "DynamoDB encryption at rest works at the table level. DynamoDB internally manages the Data Encryption Key using envelope encryption, calling KMS only to encrypt or decrypt the DEK — not the individual table items."
},
{
"answer": "You must rotate the KMS key manually every 90 days to maintain DynamoDB encryption compliance.",
"isCorrect": false,
"explanation": "There is no mandatory 90-day rotation. If you use a CMK, you can enable automatic annual rotation. If you use an AWS-managed key, rotation happens automatically every year. Neither requires manual 90-day cycles."
}
]
},
{
"question": "Which KMS key type offers the LEAST visibility and control to the AWS account owner?",
"answers": [
{
"answer": "Customer-managed key (CMK)",
"isCorrect": false,
"explanation": "CMKs offer the most control — custom key policies, rotation management, cross-account sharing, and full CloudTrail audit visibility."
},
{
"answer": "AWS-managed key",
"isCorrect": false,
"explanation": "AWS-managed keys are visible in the KMS console and logged in CloudTrail. You have some visibility but no management control. They are not the least visible option."
},
{
"answer": "AWS-owned key",
"isCorrect": true,
"explanation": "AWS-owned keys are completely invisible to the account. They do not appear in the KMS key list, you cannot view their policies, and you have no control over them whatsoever. They are used internally by some AWS services."
}
]
},
{
"question": "Why does SSE-KMS encryption in S3 have cost and throughput implications that SSE-S3 does not?",
"answers": [
{
"answer": "SSE-KMS uses a stronger encryption algorithm that requires more compute.",
"isCorrect": false,
"explanation": "Both SSE-KMS and SSE-S3 use AES-256 encryption. The cost and throughput difference is not due to the encryption algorithm."
},
{
"answer": "Each SSE-KMS operation requires a KMS API call (GenerateDataKey or Decrypt), which is billed per call and subject to KMS API rate limits.",
"isCorrect": true,
"explanation": "Every S3 object upload with SSE-KMS triggers a GenerateDataKey call, and every download triggers a Decrypt call. KMS bills per API call and enforces request rate limits, which can become a bottleneck at high throughput."
},
{
"answer": "SSE-KMS stores the encrypted DEK in a separate DynamoDB table, adding latency and cost.",
"isCorrect": false,
"explanation": "The encrypted DEK is stored in S3 object metadata, not in DynamoDB. There is no separate database involved."
}
]
}
]
{{< /qcm >}}