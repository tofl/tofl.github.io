---
title: "How to Delete a KMS Key Safely: Scheduled Deletion and Recovery"
---

## How to Delete a KMS Key Safely: Scheduled Deletion and Recovery

When working with AWS Key Management Service (KMS), you'll eventually face the question of what to do with keys you no longer need. Unlike most AWS resources, deleting a KMS key is irreversible—there's no undelete button, no recovery console, no last-minute reprieve. Once the waiting period expires, that key and all its cryptographic material vanish from AWS, taking with it the ability to decrypt any data encrypted under that key. This finality makes KMS key deletion both critical to understand and genuinely risky if approached carelessly.

The good news is that AWS has built safety mechanisms into the deletion process specifically because the operation is so consequential. Understanding these safeguards, how to use them properly, and when deletion is actually the right choice versus safer alternatives will help you manage your encryption infrastructure with confidence.

### Why KMS Key Deletion Matters

Before diving into the mechanics, let's establish why this topic deserves your attention. In most AWS services, deletion is quick and often reversible through backups or snapshots. KMS is different because the key itself is the irreplaceable artifact. Every piece of data encrypted with that key becomes permanently inaccessible once the key is deleted. This applies whether the data lives in S3, RDS, EBS, CloudWatch Logs, or any other AWS service using KMS for encryption.

Consider a real scenario: a team encrypts customer PII with a specific KMS key for compliance reasons. Years later, someone decides the key is no longer needed and deletes it, forgetting that archived backups from three years ago still rely on it. When the company needs to restore those backups for a data recovery incident, they discover the encryption key is gone. The backups exist, but they're useless without the key that encrypted them.

This scenario underscores why AWS mandates a waiting period before deletion actually takes effect. The deletion process is intentionally slow and deliberate, giving you time to reconsider, audit dependencies, and cancel if needed.

### Understanding KMS Key States and the Deletion Workflow

A KMS key exists in several distinct states throughout its lifecycle. Understanding these states is essential for safe key management.

When you create a key, it enters the **Enabled** state by default. While enabled, the key can encrypt and decrypt data, and applications can use it freely. If you want to stop using a key without deleting it, you can **disable** it. A disabled key cannot perform cryptographic operations, but AWS preserves it indefinitely. You can re-enable a disabled key at any point, restoring full functionality. This is often the safest choice for keys you might need later.

Once you decide a key must be deleted, you don't simply press a delete button and watch it vanish. Instead, you schedule the key for deletion. When deletion is scheduled, the key transitions to **pending deletion** state. This is the critical window where AWS gives you a mandatory waiting period—a grace period of 7 to 30 days, which you specify when scheduling deletion. During this period, the key remains disabled and cannot be used, but it still exists and can be recovered by canceling the deletion.

If you don't cancel deletion before the waiting period ends, the key automatically moves to the **deleted** state, and AWS permanently removes the cryptographic material. From that point forward, the key is truly gone.

### The Mandatory Waiting Period: Your Safety Net

The waiting period is non-negotiable. AWS enforces a minimum of 7 days and allows up to 30 days at your discretion. You cannot delete a key immediately, even if you're certain you want to. This design forces a moment of pause, creating an opportunity to verify that deletion is actually the right decision.

The length of the waiting period should reflect your comfort level and operational risk. A 7-day window works well for keys you're completely confident about—perhaps a development key you created for testing and know has no data dependencies. A longer window, say 14 or 21 days, suits production environments where discovering unexpected data encrypted with the key becomes more likely. Some organizations use 30 days as standard for any key that touched sensitive data.

During the waiting period, you can still query the key's metadata, view its pending deletion status, and most importantly, cancel the deletion entirely. Cancellation is instantaneous and requires no additional waiting. Once canceled, the key returns to either enabled or disabled state, depending on its configuration before you scheduled deletion.

### How to Schedule a KMS Key for Deletion

Scheduling deletion is straightforward, but the decision should never be. Let's walk through the process using both the AWS CLI and the AWS Management Console.

In the AWS CLI, the command is `schedule-key-deletion`:

```bash
aws kms schedule-key-deletion \
  --key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012 \
  --pending-window-in-days 14
```

Here, `--key-id` identifies the key you want to delete. You can use the key's ARN, its alias, or its key ID. The `--pending-window-in-days` parameter sets your waiting period. AWS will respond with confirmation, including the key ID, deletion date (calculated as current date plus your specified days), and the key's status as "PendingDeletion".

In the AWS Management Console, navigate to the KMS service, select "Customer managed keys," find your key, click on it, and look for the "Schedule key deletion" button in the key details page. A dialog will prompt you to confirm the waiting period. The console will display a clear warning about the irreversibility of this action.

Before you execute either command, you should have already performed thorough due diligence on the key's dependencies. We'll cover that in detail shortly, but the essential question is: "Is any data currently encrypted with this key?"

### Canceling Deletion: Reversing Course

If you schedule deletion and later realize you made a mistake—or discover a dependency you missed—cancellation is your escape hatch. Unlike deletion itself, cancellation is instantaneous and has no waiting period.

Using the CLI, the command is `cancel-key-deletion`:

```bash
aws kms cancel-key-deletion \
  --key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

The key will immediately return to its prior state. If it was enabled before you scheduled deletion, it's enabled again. If it was disabled, it returns to disabled. Either way, the pending deletion status is cleared, and the key is fully recoverable.

This reversibility is precisely why the waiting period exists. During those 7 to 30 days, you have a window to catch mistakes. Once the waiting period expires and the key moves to deleted state, there is no recovery mechanism whatsoever. AWS cannot restore it for you, and no support team can override it.

### Disabling vs. Deleting: Choosing the Safer Path

Before scheduling deletion, seriously consider whether disabling the key might meet your needs instead. Disabling is reversible, permanent in terms of immediate cryptographic operations, and far less risky than deletion.

You disable a key with the `disable-key` command:

```bash
aws kms disable-key \
  --key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

The key transitions to disabled state immediately. No waiting period, no scheduling, no ambiguity. While disabled, the key cannot encrypt new data, and decrypt operations will fail. However, the key itself and all its cryptographic material remain intact within AWS KMS.

If you later discover you need the key, you re-enable it just as quickly:

```bash
aws kms enable-key \
  --key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

So when should you disable versus delete? Disable if there's any chance you might need the key again—for compliance archival, legacy data decryption, or simply because the future is uncertain. Delete only when you're absolutely certain the key has no remaining dependencies and you never want to decrypt any data that used it.

In practice, many organizations rarely delete keys outright. They accumulate disabled keys from years of operational history, and that's fine. The cost of retaining a disabled key is minimal, while the risk of deleting a key you later need is severe.

### Detecting Dependencies: The Critical Pre-Deletion Analysis

This is where many teams stumble. Before scheduling deletion, you must identify every place the key might be in use. This isn't always obvious because data can be encrypted with a key years before you attempt deletion.

Start with CloudTrail. KMS integrates with CloudTrail to log all key usage, including encrypt and decrypt operations. You can query CloudTrail logs to see exactly which APIs have used the key, which AWS services invoked it, and when.

Using the AWS CLI, you might filter CloudTrail events for a specific key:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012 \
  --max-results 50
```

This returns events where the key appeared in CloudTrail logs. You'll see decrypt operations, encrypt operations, and grants created against the key. Examining these events tells you which services and applications have touched the key recently.

However, CloudTrail logs have a default retention of 90 days (if you've configured CloudTrail with S3 storage, retention can extend much longer). If data was encrypted years ago and hasn't been accessed recently, it might not appear in recent CloudTrail logs. This is why CloudTrail alone is insufficient.

The more comprehensive approach involves checking each AWS service directly. Query S3 to find objects encrypted with the key. Check RDS to see which databases use it for encryption. Examine EBS snapshots and volumes. Look at secrets stored in AWS Secrets Manager. Check CloudWatch Logs, DynamoDB, and any other service that can use KMS keys.

For S3, you can list buckets and check their encryption settings:

```bash
aws s3api list-buckets
aws s3api get-bucket-encryption --bucket my-bucket
```

For RDS, inspect database instances:

```bash
aws rds describe-db-instances \
  --query 'DBInstances[?KmsKeyId==`arn:aws:kms:...`]'
```

For EBS:

```bash
aws ec2 describe-volumes \
  --query 'Volumes[?KmsKeyId==`arn:aws:kms:...`]'
```

This manual checking is tedious but essential. You're looking for any resource that explicitly references the key ARN in its encryption configuration or any resource encrypted with the key that might generate future decrypt requests.

A helpful pattern is to create an AWS Lambda function that periodically scans your AWS account for key dependencies. The function can check each service systematically and alert you to dependencies before you even consider deletion. This takes the guesswork out of the process.

Additionally, if you manage multiple AWS accounts, don't forget about cross-account usage. A key in one account might be used by a service in another account via cross-account KMS permissions. Your dependency analysis must span all accounts in your organization.

### What Happens to Encrypted Data After Key Deletion

This is the sobering reality worth understanding in full. When a KMS key is deleted, any data encrypted with that key becomes permanently inaccessible through normal means.

If you have an S3 object encrypted with the deleted key, attempting to retrieve it will fail with an error indicating that the key is unavailable. The object itself still exists in S3—AWS doesn't delete the object—but you cannot decrypt it. It's cryptographically inaccessible.

The same applies to RDS encrypted databases, EBS snapshots, secrets in Secrets Manager, or any other encrypted data. The data persists, but decryption becomes impossible. From a practical standpoint, it's as though the data was deleted, even though technically it remains stored somewhere.

There's no way to "force" decryption of data encrypted with a deleted key. AWS has no backdoor, no master key hidden in a vault, no emergency override. The cryptographic design of KMS explicitly prevents this. Once the key material is deleted, only the original key holder could decrypt the data, and that key holder no longer has access to the key. The data is gone for all practical purposes.

This reality reinforces why dependency analysis is so critical. You must have high confidence that no encrypted data depends on the key before deletion.

### Best Practices for Safe KMS Key Deletion

Several operational patterns can help you delete keys safely and minimize the risk of catastrophe.

Implement a formal change control process for key deletion. Don't allow individuals to schedule deletion on a whim. Require a ticket, a business justification, and peer review. Ensure multiple people sign off on the decision. This overhead prevents hasty decisions.

Always start with a full dependency audit before scheduling deletion. Document what you found, what you checked, and any assumptions you made. If another team discovers a dependency later, you'll have a record of your due diligence.

Use the longest reasonable waiting period. If you're uncomfortable with a 7-day window, use 14 or 21. The extra days cost you nothing and provide a better safety margin for discovering missed dependencies.

Document your key deletion schedule in a centralized location. Some organizations maintain a spreadsheet or database listing all keys marked for deletion, their scheduled deletion dates, and the business reason for deletion. This creates visibility and allows others to flag concerns before the deletion actually occurs.

Enable logging and monitoring on key deletion operations. Use CloudTrail to track who scheduled deletion and when. Set up CloudWatch alarms to notify you when any deletion is scheduled. This audit trail helps you track changes and understand the history of your key lifecycle.

Consider implementing AWS Config rules to monitor key status and alert on keys in pending deletion state. You can create custom rules that check whether any keys have been in pending deletion for an unusually long time, which might indicate a forgotten key.

### Working with Key Aliases and Deletion

One subtle but important consideration involves key aliases. An alias is a friendly name you give to a key, like `alias/my-application-key`. Aliases are stored separately from the actual key material.

When you delete a key, AWS automatically deletes its associated aliases. However, if your application code references a key by alias, failing to update that code before deletion can cause unexpected errors. Applications attempting to use the alias after deletion will receive "alias not found" errors, which can trigger alarms or failures.

Before deletion, audit your code and configuration to find all references to the key's alias. Update application code to use a different key or to handle the missing key gracefully. This prevents cascading failures when the key is deleted.

You can list aliases associated with a key:

```bash
aws kms list-aliases \
  --key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

This returns all aliases pointing to the key, allowing you to identify everywhere the alias might be referenced.

### Key Deletion and Compliance Requirements

Some organizations operate under compliance frameworks that specify how long encryption keys must be retained. HIPAA, PCI-DSS, SOC 2, and other standards might require that keys be kept for a certain period after data is deleted, or they might prohibit deletion entirely without explicit audit trails.

Before deleting a key in a regulated environment, consult your compliance documentation and security team. You might discover that your organization's policy forbids deletion and requires that keys be disabled indefinitely instead. Or you might find that deletion is permitted but requires extensive documentation and approvals.

This is another reason why disabling keys is often preferable to deleting them. Disabled keys satisfy most compliance requirements around "no longer in use" while avoiding the finality of deletion. When your audit comes around, you have a clear record of when the key was disabled and why, without the risk of having irreversibly destroyed it.

### Monitoring and Alerting for Key Deletion Events

Building observability around key deletion helps you catch problems early. You can set up CloudWatch alarms to notify you when key deletion is scheduled, when the waiting period is about to expire, or when a key has been deleted.

Using CloudTrail events as the source, create a CloudWatch Events rule (now called EventBridge) that matches KMS deletion API calls:

```json
{
  "source": ["aws.kms"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventName": ["ScheduleKeyDeletion"]
  }
}
```

This rule triggers whenever anyone schedules a key for deletion in your account. You can send the event to an SNS topic, a Lambda function, or directly to a Slack webhook, alerting your team immediately.

Similarly, you can set up a Lambda function that runs periodically and checks for keys in pending deletion state:

```python
import boto3

kms = boto3.client('kms')

def check_pending_deletions():
    response = kms.list_keys()
    pending_keys = []
    
    for key in response['Keys']:
        key_metadata = kms.describe_key(KeyId=key['KeyId'])
        if key_metadata['KeyMetadata']['KeyState'] == 'PendingDeletion':
            pending_keys.append({
                'KeyId': key['KeyId'],
                'DeletionDate': key_metadata['KeyMetadata']['DeletionDate']
            })
    
    return pending_keys
```

Running this function on a schedule—perhaps daily—gives you a comprehensive view of which keys are awaiting deletion. You can cross-reference this list against your change control tickets and your dependency audit records. If you find a key scheduled for deletion that doesn't match any approved change request, you have time to investigate and cancel if needed.

### Recovery and Disaster Scenarios

Despite best efforts, deletion mistakes can happen. A developer might delete the wrong key, or a dependency might slip through your audit. If you're within the waiting period, cancellation is your remedy. After the waiting period expires, however, your options are limited.

If a deletion has occurred and encrypted data is now inaccessible, your only recourse is to restore from unencrypted backups, if you have them. This is why many organizations maintain dual backups: one encrypted with KMS (for security) and one unencrypted or encrypted with a different key (for disaster recovery). If the primary key is deleted, you can restore from the alternate backup.

This is also why having at least one recent backup of any data encrypted with a key is wise operational practice. Encryption protects against unauthorized access, but backups protect against administrative mistakes.

### Testing Deletion Workflows in Non-Production

Before you ever delete a production KMS key, practice the process in a development or staging environment. Create a test key, encrypt some data with it, schedule deletion, verify that the encrypted data becomes inaccessible, and then test cancellation. This hands-on experience builds confidence in the process and helps you develop standard procedures.

Testing also allows you to verify that your monitoring and alerting systems work as expected. You can trigger the deletion workflow and watch CloudTrail logs populate, CloudWatch alarms fire, and any automated workflows respond appropriately.

### Conclusion

Deleting a KMS key is permanent and dangerous, which is exactly why AWS surrounds it with multiple safety mechanisms. The mandatory waiting period, the ability to cancel deletion, the requirement for deliberate API calls or console actions—these features exist because the alternative (immediate, irreversible deletion) would be catastrophic.

Your approach to KMS key deletion should always prioritize safety over speed. Take time for thorough dependency analysis before scheduling deletion. Use the longest waiting period you're comfortable with. Implement formal change control and cross-team review. Consider disabling keys instead of deleting them when the future is uncertain. Monitor and alert on deletion events so you can catch mistakes early.

The best deletion is the one you don't have to make because you've architected your key lifecycle wisely from the beginning. But when deletion does become necessary, approach it with the deliberation and caution it demands.
