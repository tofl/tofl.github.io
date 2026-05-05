---
title: "CloudTrail Event Details: Understanding the userIdentity, requestParameters, and responseElements Fields"
---

## CloudTrail Event Details: Understanding the userIdentity, requestParameters, and responseElements Fields

When something goes wrong in your AWS environment—or when you simply need to understand who did what and when—CloudTrail is your investigative lifeline. Every API call made against your AWS resources gets logged as a CloudTrail event, a structured JSON document containing a wealth of information. However, that structure can feel overwhelming at first. The raw JSON contains dozens of fields, many of which are optional, and understanding which fields to focus on when investigating an incident or building automated analysis tools is a skill that separates novice AWS developers from seasoned practitioners.

This article takes you deep into three critical CloudTrail event fields: `userIdentity`, `requestParameters`, and `responseElements`. These fields form the narrative backbone of every CloudTrail event—they tell you who made the call, what they asked AWS to do, and what AWS actually returned. By mastering these fields, you'll be able to troubleshoot issues faster, build more effective audit tools, and develop a clearer mental model of how AWS API activity actually flows through your infrastructure.

### The CloudTrail Event: A Quick Foundation

Before diving into specific fields, let's establish context. A CloudTrail event is a JSON record that AWS creates whenever an API call is made in your account. This includes actions taken via the AWS Management Console, the CLI, SDKs, and direct API calls. CloudTrail events are stored in S3 buckets (or can be delivered to CloudWatch Logs), and they're typically compressed and batched into files containing multiple events.

Each event contains metadata about the API call—when it happened, what service was called, whether it succeeded—along with the three fields we're about to examine. Understanding this structure is foundational for anyone building CloudTrail analyzers, compliance tools, or incident response workflows.

### The userIdentity Object: Who Made the Call

The `userIdentity` object is your answer to the first investigative question: who made this API call? This field is present in virtually every CloudTrail event, and its structure varies depending on the type of principal that made the call.

The `userIdentity` object always contains a `type` field that tells you what kind of principal we're dealing with. Let's explore each principal type and what the object looks like in each case.

#### Root Account Access

When the root user of an AWS account makes an API call, the `userIdentity` object looks like this:

```json
{
  "userIdentity": {
    "type": "Root",
    "principalId": "123456789012",
    "arn": "arn:aws:iam::123456789012:root",
    "accountId": "123456789012",
    "userName": "root"
  }
}
```

The `principalId` for a root user is simply the AWS account ID. Notice there's a `userName` field set to "root", which is a literal string, not an actual username. This is important: root access is relatively rare in modern AWS environments, and when you see this in your logs, it's often worth investigating. Root users should be using multi-factor authentication (MFA), and in many organizations, root access should trigger alerts or be restricted entirely.

#### IAM Users

When an IAM user makes an API call, the structure is slightly different:

```json
{
  "userIdentity": {
    "type": "IAMUser",
    "principalId": "AIDAJ45Q7YFFAREXAMPLE",
    "arn": "arn:aws:iam::123456789012:user/alice",
    "accountId": "123456789012",
    "userName": "alice"
  }
}
```

Here, the `principalId` is the unique ID of the IAM user, not the account ID. The `userName` is the actual name you assigned to the user when you created it. This is the most straightforward case and often appears when developers or operators are making manual API calls.

#### IAM Roles and Assumed Credentials

When someone assumes an IAM role—either another IAM user assuming a role, or a service principal assuming a role—the userIdentity object looks different:

```json
{
  "userIdentity": {
    "type": "AssumedRole",
    "principalId": "AIDACKCEVSQ6C2EXAMPLE:session-name",
    "arn": "arn:aws:iam::123456789012:role/lambda-execution-role",
    "accountId": "123456789012",
    "userName": "lambda-execution-role/session-name"
  }
}
```

Notice that the `principalId` is now a composite: it includes both the role ID and a session name, separated by a colon. The session name is a label that uniquely identifies this particular session of assuming the role. This is crucial information when you're investigating actions taken by Lambda functions, EC2 instances, or other AWS services running under an assumed role. The `arn` field tells you which role was assumed.

#### AWS Service Principals

Sometimes the caller isn't a human or a user, but an AWS service itself. For example, CloudFormation might make API calls on your behalf when you're creating a stack. In this case:

```json
{
  "userIdentity": {
    "type": "AWSService",
    "principalId": "cloudformation.amazonaws.com",
    "userName": "cloudformation"
  }
}
```

The `principalId` here is the service principal identifier. Notice that this event doesn't have an `arn` or `accountId` field—those only appear for principals within your account. This type of event is common when you're using higher-level AWS services that make underlying API calls on your behalf.

#### Federated Users

If you've integrated AWS with an external identity provider—like an SAML provider, OpenID Connect, or AWS SSO—a federated user making an API call will have a structure like this:

```json
{
  "userIdentity": {
    "type": "FederatedUser",
    "principalId": "example.com:user@example.com",
    "arn": "arn:aws:iam::123456789012:federated-user/user@example.com",
    "accountId": "123456789012",
    "userName": "example.com:user@example.com"
  }
}
```

The `principalId` and `userName` are typically in a domain-qualified format. The `arn` indicates this is a federated user. This is becoming increasingly common as organizations move toward centralized identity management.

#### The accessKeyId Field

Across most of these principal types, you may also see an `accessKeyId` field in the `userIdentity` object:

```json
{
  "userIdentity": {
    "type": "IAMUser",
    "principalId": "AIDAJ45Q7YFFAREXAMPLE",
    "arn": "arn:aws:iam::123456789012:user/alice",
    "accountId": "123456789012",
    "userName": "alice",
    "accessKeyId": "AKIAIOSFODNN7EXAMPLE"
  }
}
```

This is the access key ID used to authenticate the request. When you're investigating a specific access key that you suspect has been compromised, you can search CloudTrail events for this value across a time range. This is essential for security incident response—if an access key leaks, you can use this field to identify exactly which API calls were made with that key.

### requestParameters: What the Caller Asked For

Now that you know *who* made the call, the next question is: *what did they ask AWS to do?* This is where `requestParameters` comes in. This field contains the parameters that were passed to the AWS API action.

The structure of `requestParameters` varies dramatically depending on which AWS service and API action was called. Let's walk through several examples to build intuition for how to interpret this field.

#### A Simple EC2 Example

Suppose someone called the `DescribeInstances` API action to list EC2 instances. The `requestParameters` might look like:

```json
{
  "requestParameters": {
    "instancesSet": [
      "i-1234567890abcdef0"
    ]
  }
}
```

Here, the caller was asking to describe a specific instance. The parameter name `instancesSet` (note the peculiar AWS XML-style naming convention) contains an array of instance IDs they wanted information about. If the requestParameters were null or an empty object, it would mean they asked for all instances.

#### An S3 Operation

Consider an S3 PutObject operation to upload a file:

```json
{
  "requestParameters": {
    "bucketName": "my-application-bucket",
    "key": "logs/application-2024-01-15.log",
    "x-amz-server-side-encryption": "AES256",
    "x-amz-storage-class": "STANDARD_IA"
  }
}
```

The `requestParameters` tell you exactly what object was being uploaded (the `key`), to which bucket, and with what options (server-side encryption, storage class). This level of detail is invaluable when investigating unauthorized file uploads or compliance violations.

#### An IAM Operation

When someone modifies an IAM user, the `requestParameters` becomes more complex:

```json
{
  "requestParameters": {
    "userName": "developer-user",
    "groupNameList": [
      "developers",
      "administrators"
    ]
  }
}
```

This tells you that someone added the user "developer-user" to both the "developers" and "administrators" groups. If that second group assignment was unexpected, you've found your smoking gun—and you can check the `userIdentity` field to see exactly who added the user to that privileged group.

#### Sensitive Parameters Are Masked

Here's something critical: CloudTrail masks certain sensitive parameters in `requestParameters`. For example, if someone calls the `CreateDBInstance` API to create a database, the master password will not appear in `requestParameters`—it's redacted for security. Similarly, secret values passed to Secrets Manager or Systems Manager Parameter Store are masked. This is a security feature built into CloudTrail itself.

That said, you should never rely on CloudTrail to protect secrets. The fact that a parameter is redacted doesn't mean the secret wasn't used—it just means you won't see it in the logs. This is why proper access controls, encryption, and secrets management are so critical in AWS.

#### requestParameters Can Be Null

One final important note: `requestParameters` can be null or an empty object if the API action doesn't take any parameters or if the parameters are passed in the request body rather than as query strings. For instance, a call to `GetObject` in S3 might have minimal or no parameters in this field, since the bucket and key are often part of the URL path.

### responseElements: What AWS Returned

The `responseElements` field contains the response that AWS returned from the API call. This is crucial for understanding the outcome of an action. However, CloudTrail doesn't capture the entire response body for most services—instead, it captures key elements that are useful for auditing and troubleshooting.

#### Understanding What Gets Logged

The `responseElements` field is often small or even null because AWS deliberately limits what gets logged here. The reasoning is practical: response payloads can be enormous (consider an API call that returns gigabytes of data), and logging the entire response would be inefficient and potentially unnecessary. Instead, CloudTrail logs elements that are most useful for auditing: identifiers of created resources, confirmation of what was modified, and error information if the call failed.

#### Creating a Resource

When you create a new resource, the response often includes the identifier of that resource. For example, creating an EC2 security group:

```json
{
  "responseElements": {
    "groupId": "sg-0123456789abcdef0",
    "groupName": "my-security-group"
  }
}
```

This tells you exactly which security group was created. Combined with the `requestParameters`, you now have a complete picture: someone created a security group with specific name, and here's the ID that AWS assigned to it.

#### Modifying a Resource

When you modify a resource, the response might confirm the change:

```json
{
  "responseElements": {
    "return": true
  }
}
```

That simple boolean tells you the operation succeeded. For some operations, the response will include more detail about what was actually modified.

#### What About Failed Calls?

Here's something important: when an API call fails, `responseElements` is typically null or empty. Instead, look at the `errorCode` and `errorMessage` fields at the root level of the CloudTrail event. These fields tell you why the call failed. For instance:

```json
{
  "eventName": "RunInstances",
  "requestParameters": {
    "instanceType": "t2.micro",
    "imageId": "ami-0c55b159cbfafe1f0"
  },
  "errorCode": "InsufficientInstanceCapacity",
  "errorMessage": "We currently do not have sufficient t2.micro capacity in the Availability Zone",
  "responseElements": null
}
```

The `responseElements` being null combined with the `errorCode` tells the complete story: the request was made, but AWS couldn't fulfill it due to capacity constraints.

#### A Real-World Example: Attaching a Policy

Let's walk through a complete example that ties together `requestParameters` and `responseElements`. Suppose an IAM administrator attaches a managed policy to a role:

```json
{
  "eventName": "AttachRolePolicy",
  "userIdentity": {
    "type": "IAMUser",
    "principalId": "AIDAJ45Q7YFFAREXAMPLE",
    "arn": "arn:aws:iam::123456789012:user/admin",
    "userName": "admin"
  },
  "requestParameters": {
    "roleName": "lambda-execution-role",
    "policyArn": "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  },
  "responseElements": {
    "return": true
  }
}
```

Reading this event: the IAM user "admin" attached the managed policy "AWSLambdaBasicExecutionRole" to the role "lambda-execution-role", and the operation succeeded. This is auditing gold.

### Additional Context: sourceIPAddress and additionalEventData

While `userIdentity`, `requestParameters`, and `responseElements` form the core narrative of a CloudTrail event, two other fields often provide critical context.

The `sourceIPAddress` field tells you where the API call originated geographically. This is useful for identifying suspicious activity—if a developer's credentials are being used from an IP address in a country where they've never worked, that's a red flag. For calls made by AWS services (like Lambda), the source IP will typically be an AWS IP address range.

The `additionalEventData` field captures context that doesn't fit neatly into the main structure. For example, when data is encrypted with AWS KMS, this field will contain the KMS key ARN that was used:

```json
{
  "additionalEventData": {
    "x-amz-kms-key-id": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
  }
}
```

This is invaluable when you're troubleshooting encryption issues or auditing which keys are being used for data protection.

### Practical Example: Investigating a Suspicious IAM Change

Let's bring all of this together with a realistic investigation scenario. Suppose your security team alerts you that a new access key was created for an IAM user, but nobody remembers requesting it. You need to find the CloudTrail event that created it.

You'll search CloudTrail for events with `eventName` equal to `CreateAccessKey`. When you find the event, you examine:

**The userIdentity object** tells you who created the key. If it was created by someone unexpected—or by a role that shouldn't have permission to do so—you've identified your problem.

**The requestParameters object** tells you which IAM user the key was created for:

```json
{
  "requestParameters": {
    "userName": "application-service"
  }
}
```

**The responseElements object** gives you the access key ID:

```json
{
  "responseElements": {
    "accessKey": {
      "accessKeyId": "AKIAIOSFODNN7EXAMPLE",
      "userName": "application-service"
    }
  }
}
```

You now know: who created the key, which user it was created for, and what the key ID is. You can then search for all API calls made with this access key ID (by searching for `accessKeyId` in the `userIdentity` object) to see what the key has been used for. If the key was created by an unauthorized principal or has been used to access sensitive resources, you can disable it immediately and investigate further.

### Building CloudTrail Analysis Tools

Understanding these fields is not just useful for manual investigation—it's essential if you're building tools to analyze CloudTrail events programmatically. Many organizations write Lambda functions, Python scripts, or use tools like Athena to query CloudTrail logs and identify specific patterns.

For example, you might write a function that searches for all CreateUser events and extracts key information:

```python
def analyze_user_creation_events(events):
    results = []
    for event in events:
        if event.get('eventName') != 'CreateUser':
            continue
        
        creator = event['userIdentity'].get('userName', 'unknown')
        new_user = event['requestParameters'].get('userName')
        
        results.append({
            'created_by': creator,
            'new_user': new_user,
            'timestamp': event['eventTime'],
            'source_ip': event['sourceIPAddress']
        })
    
    return results
```

This simple script demonstrates how understanding the field structure lets you quickly extract relevant information from thousands of events. In production, you'd add error handling and possibly filter for suspicious patterns (like users created outside business hours, or multiple users created in rapid succession).

### Common Pitfalls and Best Practices

As you work with CloudTrail events, keep a few important points in mind.

First, remember that `requestParameters` and `responseElements` are not guaranteed to contain sensitive information—they're redacted by CloudTrail. Don't assume that seeing CloudTrail events proves no secrets were leaked; instead, rely on proper access controls and secrets management practices.

Second, be aware that some AWS services integrate with CloudTrail differently than others. CloudTrail data events (which log actual object-level activity in S3, Lambda, RDS, etc.) are turned off by default and require explicit configuration. Management events (the default) only log API calls, not what happened to your data. If you're investigating an S3 bucket modification, make sure you have data events enabled.

Third, remember that the principal making the call might not be a human. When you see `AssumedRole` type principals, the actual human operator is one or more steps removed. The role might have been assumed by a service, which was triggered by another service, which was ultimately triggered by a human. Tracking down the full chain of causation can be complex but is often necessary for proper incident response.

Finally, always correlate CloudTrail events with other signals. A CloudTrail event tells you *what* happened, but context from CloudWatch alarms, VPC Flow Logs, or application logs can tell you *why* it happened and *what the impact was*. CloudTrail is one piece of a comprehensive observability strategy, not the whole picture.

### Conclusion

The `userIdentity`, `requestParameters`, and `responseElements` fields are the heart of every CloudTrail event. The `userIdentity` object answers the question of who made the call and in what capacity. The `requestParameters` field shows you exactly what was requested. The `responseElements` field tells you what AWS returned. Together, they form a complete audit trail of API activity in your AWS environment.

Mastering these fields—understanding their structure, knowing how to interpret them for different principal types and AWS services, and building the intuition to quickly extract relevant information—is a skill that will serve you well whether you're troubleshooting production issues, responding to security incidents, or building automated compliance tools. The more comfortable you become with CloudTrail event structure, the faster you'll be able to answer the critical questions that arise in any AWS environment: who did what, when, and with what result.
