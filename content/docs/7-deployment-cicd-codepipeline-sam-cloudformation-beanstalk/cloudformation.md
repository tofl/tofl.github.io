---
title: "21. CloudFormation"
type: docs
weight: 3
---

## CloudFormation

AWS CloudFormation lets you define your entire AWS infrastructure as code — VPCs, databases, Lambda functions, IAM roles, and more — in a single declarative template. Instead of clicking through the console or running ad-hoc CLI commands, you describe *what* you want, and CloudFormation figures out *how* to create it, in the right order, handling dependencies automatically.

The core problem it solves is repeatability. Without IaC, recreating a production environment in a new region, or letting a teammate spin up an identical dev stack, is error-prone and slow. With CloudFormation, you version-control your infrastructure alongside your application code and deploy it consistently every time.

### Template Structure

A CloudFormation template is a YAML or JSON file with a set of top-level sections. Only `Resources` is mandatory; the rest are optional but frequently used [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-anatomy.html).

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Description: "My application stack"

Parameters:   # User inputs at deploy time
Mappings:     # Static lookup tables
Conditions:   # Boolean logic to toggle resources
Resources:    # The actual AWS resources (required)
Outputs:      # Values to expose after stack creation
```

### Resources

Every AWS resource you want CloudFormation to manage is declared under `Resources`. Each resource has a logical ID (used to reference it within the template), a `Type`, and `Properties` [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resources-section-structure.html).

```yaml
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-app-assets
      VersioningConfiguration:
        Status: Enabled
```

The logical ID (`MyBucket`) is how other parts of the template refer to this resource. The full list of supported resource types and their properties lives in the [AWS resource and property types reference](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-template-resource-type-ref.html).

### Parameters

Parameters make templates reusable by accepting input at deploy time instead of hardcoding values [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html).

```yaml
Parameters:
  EnvironmentName:
    Type: String
    AllowedValues: [dev, staging, prod]
    Default: dev
  InstanceType:
    Type: String
    Default: t3.micro
```

Common parameter types include `String`, `Number`, `AWS::EC2::KeyPair::KeyName`, and `AWS::SSM::Parameter::Value<String>` (which fetches a value directly from SSM at deploy time). You can add constraints like `MinLength`, `MaxLength`, `AllowedPattern`, and `AllowedValues` to validate input before the stack even starts creating resources.

**Pseudo-parameters** are built-in values AWS provides automatically — no declaration needed. The most useful ones:

- `AWS::AccountId` — the current AWS account ID
- `AWS::Region` — the region being deployed into
- `AWS::StackName` — the name of the current stack

### Mappings and Fn::FindInMap

Mappings are static lookup tables embedded in the template — useful for region-specific AMI IDs, or environment-specific configurations [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/mappings-section-structure.html).

```yaml
Mappings:
  RegionAMIMap:
    us-east-1:
      AMI: ami-0abcdef1234567890
    eu-west-1:
      AMI: ami-0fedcba9876543210
```

You look up a value with `Fn::FindInMap`:

```yaml
ImageId: !FindInMap [RegionAMIMap, !Ref AWS::Region, AMI]
```

This is a common pattern for making templates work across multiple regions without hardcoding AMI IDs.

### Conditions

Conditions let you create or configure resources only when certain criteria are met — for example, only creating a larger instance type in production [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/conditions-section-structure.html).

```yaml
Conditions:
  IsProd: !Equals [!Ref EnvironmentName, prod]

Resources:
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      InstanceType: !If [IsProd, m5.large, t3.micro]
```

The key condition functions are `Fn::Equals`, `Fn::If`, `Fn::And`, `Fn::Or`, and `Fn::Not`. Conditions can be applied to entire resources (to conditionally create them) or to individual property values.

### Intrinsic Functions

Intrinsic functions are CloudFormation's built-in helpers for dynamic values [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html). The ones you'll use constantly:

- **`Ref`** — returns the primary identifier of a resource (e.g., a bucket name, a security group ID) or the value of a parameter.
```yaml
  BucketName: !Ref MyBucket
```

- **`Fn::GetAtt`** — retrieves a specific attribute of a resource that `Ref` doesn't expose, like an S3 bucket's ARN or a load balancer's DNS name.
```yaml
  BucketArn: !GetAtt MyBucket.Arn
```

- **`Fn::Sub`** — string substitution, the cleanest way to build ARNs or resource names dynamically.
```yaml
  FunctionArn: !Sub "arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:my-function"
```

- **`Fn::Join`** — concatenates a list of values with a delimiter. Often replaced by `Fn::Sub` in modern templates, but still common.
```yaml
  !Join ["-", [!Ref EnvironmentName, "bucket"]]
```

- **`Fn::Select`** — picks one element from a list by index.
```yaml
  !Select [0, !GetAZs ""]   # First availability zone in the region
```

### Outputs and Cross-Stack References

Outputs expose values from a stack — useful for displaying information after deployment (like an endpoint URL) or for sharing values between stacks [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/outputs-section-structure.html).

```yaml
Outputs:
  BucketName:
    Value: !Ref MyBucket
    Export:
      Name: !Sub "${AWS::StackName}-BucketName"
```

Another stack in the same account and region can then import this value with `Fn::ImportValue`:

```yaml
BucketName: !ImportValue MyBaseStack-BucketName
```

This pattern — called **cross-stack references** — lets you split a large infrastructure into focused stacks (networking, data, application) while still sharing outputs between them. One important constraint: you cannot delete a stack that has exported values still being imported by another stack.

### Stacks, Updates, and Change Sets

A **stack** is a deployed instance of a template. You create, update, and delete stacks as a unit — CloudFormation manages the full lifecycle of every resource inside it [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-whatis-concepts.html).

When you update a template and redeploy, CloudFormation compares the new template against the deployed state and figures out the minimal set of changes needed. Before executing an update, you can preview the changes using a **change set** — it shows exactly which resources will be added, modified, or replaced, without actually making any changes [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html). This is the recommended practice before any production update.

### Nested Stacks and StackSets

As infrastructure grows, a single template becomes unwieldy. **Nested stacks** let you compose a parent stack from reusable child stacks, each responsible for a discrete piece of infrastructure (e.g., a VPC stack, an RDS stack) [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-nested-stacks.html).

```yaml
Resources:
  VpcStack:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: https://s3.amazonaws.com/my-bucket/vpc.yaml
      Parameters:
        CidrBlock: "10.0.0.0/16"
```

**StackSets** take this further — they let you deploy a single template across multiple AWS accounts and regions simultaneously, which is essential for organizations managing multi-account environments [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/what-is-cfnstacksets.html).

### Stack Policies and Drift Detection

A **stack policy** is a JSON document that controls which resources can be updated or replaced during a stack update — useful for protecting stateful resources like RDS instances from accidental replacement [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html).

**Drift detection** identifies resources whose actual configuration has diverged from what the template declares — for example, someone manually changed a security group rule through the console. Running drift detection tells you exactly what's out of sync [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html).

### DeletionPolicy and UpdateReplacePolicy

By default, when a resource is removed from a template (or when a stack is deleted), CloudFormation deletes the underlying resource. `DeletionPolicy` overrides this behavior [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-deletionpolicy.html):

```yaml
MyDatabase:
  Type: AWS::RDS::DBInstance
  DeletionPolicy: Snapshot   # Takes a final snapshot before deleting
  UpdateReplacePolicy: Retain # Retains the old resource if replaced during an update
```

The three options for `DeletionPolicy` are `Delete` (default), `Retain` (leave the resource in place), and `Snapshot` (supported on RDS, ElastiCache, and a few others). `UpdateReplacePolicy` applies the same logic when CloudFormation must *replace* a resource during an update rather than modify it in place.

For production databases and S3 buckets containing critical data, always set `DeletionPolicy: Retain` or `Snapshot`. Accidentally deleting a production database by removing its resource block from a template is a painful lesson.

### EC2 Helper Scripts: cfn-init, cfn-signal, cfn-hup

When bootstrapping EC2 instances, CloudFormation provides three helper scripts that run on the instance itself [🔗](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-helper-scripts-reference.html):

- **`cfn-init`** reads the `AWS::CloudFormation::Init` metadata block on the resource and uses it to install packages, write files, and start services — a more structured alternative to raw `UserData` scripts.

- **`cfn-signal`** sends a success or failure signal back to CloudFormation after the instance finishes bootstrapping. This is used with **creation policies** (`CreationPolicy`) to make CloudFormation wait for the instance to report ready before marking the resource as `CREATE_COMPLETE`. Without it, CloudFormation considers the EC2 instance created as soon as the API call succeeds — not when the application is actually running.

- **`cfn-hup`** is a daemon that polls for changes to the resource's metadata and re-runs `cfn-init` when it detects updates. This enables configuration changes to be pushed to running instances without replacing them.

```yaml
MyInstance:
  Type: AWS::EC2::Instance
  CreationPolicy:
    ResourceSignal:
      Timeout: PT10M   # Wait up to 10 minutes for the signal
  Metadata:
    AWS::CloudFormation::Init:
      config:
        packages:
          yum:
            httpd: []
        services:
          sysvinit:
            httpd:
              enabled: true
              ensureRunning: true
  Properties:
    UserData:
      Fn::Base64: !Sub |
        #!/bin/bash
        /opt/aws/bin/cfn-init -v --stack ${AWS::StackName} --resource MyInstance --region ${AWS::Region}
        /opt/aws/bin/cfn-signal -e $? --stack ${AWS::StackName} --resource MyInstance --region ${AWS::Region}
```

These scripts are especially relevant when you need EC2 instances to configure themselves at launch and need CloudFormation to know when that configuration is complete.

{{< qcm >}}
[
{
"question": "Which section is the ONLY mandatory section in an AWS CloudFormation template?",
"answers": [
{
"answer": "Parameters",
"isCorrect": false,
"explanation": "Parameters is optional. It allows users to pass input values at deploy time, but a template can function without it."
},
{
"answer": "Resources",
"isCorrect": true,
"explanation": "Resources is the only required section in a CloudFormation template. It defines the AWS resources to be created and managed by the stack."
},
{
"answer": "Outputs",
"isCorrect": false,
"explanation": "Outputs is optional. It exposes values after stack creation but is not required for a valid template."
},
{
"answer": "Mappings",
"isCorrect": false,
"explanation": "Mappings is optional. It provides static lookup tables but a template does not need it to be valid."
}
]
},
{
"question": "A developer wants to retrieve the ARN of an S3 bucket defined in the same CloudFormation template. The bucket's logical ID is `MyBucket`. Which intrinsic function should be used?",
"answers": [
{
"answer": "!Ref MyBucket",
"isCorrect": false,
"explanation": "!Ref returns the primary identifier of a resource (e.g., the bucket name for S3), not its ARN."
},
{
"answer": "!GetAtt MyBucket.Arn",
"isCorrect": true,
"explanation": "Fn::GetAtt retrieves specific attributes of a resource that Ref does not expose, such as the ARN of an S3 bucket."
},
{
"answer": "!Sub MyBucket.Arn",
"isCorrect": false,
"explanation": "Fn::Sub is used for string substitution and cannot directly retrieve resource attributes like an ARN."
},
{
"answer": "!FindInMap [MyBucket, Arn]",
"isCorrect": false,
"explanation": "Fn::FindInMap is used to look up values in the Mappings section, not to retrieve attributes of resources."
}
]
},
{
"question": "A CloudFormation template needs to deploy different EC2 instance types depending on whether the environment is `prod` or not. Which combination of CloudFormation features should be used?",
"answers": [
{
"answer": "Mappings and Fn::FindInMap",
"isCorrect": false,
"explanation": "Mappings with FindInMap is a valid approach for static lookups but is less idiomatic for conditional logic. The Conditions section with Fn::If is the standard pattern for this use case."
},
{
"answer": "Conditions with Fn::Equals and Fn::If",
"isCorrect": true,
"explanation": "Conditions allow you to define boolean logic (e.g., IsProd: !Equals [!Ref EnvironmentName, prod]) and Fn::If lets you switch between values based on that condition, which is the canonical pattern for environment-specific configurations."
},
{
"answer": "Parameters with AllowedValues only",
"isCorrect": false,
"explanation": "Parameters with AllowedValues restrict valid inputs but do not provide logic to automatically select a value based on the environment."
},
{
"answer": "Outputs and cross-stack references",
"isCorrect": false,
"explanation": "Outputs and cross-stack references are used to share values between stacks, not to conditionally configure resources within a single stack."
}
]
},
{
"question": "Which pseudo-parameter would you use to dynamically reference the AWS region a stack is being deployed into, without hardcoding it?",
"answers": [
{
"answer": "AWS::AccountId",
"isCorrect": false,
"explanation": "AWS::AccountId returns the current AWS account ID, not the region."
},
{
"answer": "AWS::StackName",
"isCorrect": false,
"explanation": "AWS::StackName returns the name of the current stack, not the region."
},
{
"answer": "AWS::Region",
"isCorrect": true,
"explanation": "AWS::Region is a built-in pseudo-parameter that automatically resolves to the region where the stack is being deployed, making templates portable across regions."
},
{
"answer": "AWS::NoValue",
"isCorrect": false,
"explanation": "AWS::NoValue is used to remove a property from a resource (e.g., in conditional blocks), not to reference the current region."
}
]
},
{
"question": "A team wants to look up a region-specific AMI ID in a CloudFormation template without hardcoding it. The AMI IDs are stored in a `Mappings` section keyed by region. Which intrinsic function should they use?",
"answers": [
{
"answer": "!Ref",
"isCorrect": false,
"explanation": "Ref is used to return the value of a parameter or the primary identifier of a resource, not to look up values in Mappings."
},
{
"answer": "!FindInMap",
"isCorrect": true,
"explanation": "Fn::FindInMap is specifically designed to look up values in the Mappings section. Combined with !Ref AWS::Region, it enables region-specific value resolution."
},
{
"answer": "!ImportValue",
"isCorrect": false,
"explanation": "Fn::ImportValue is used to import exported Output values from another stack, not to look up values in Mappings."
},
{
"answer": "!Select",
"isCorrect": false,
"explanation": "Fn::Select picks an element from a list by index and is not used for Mappings lookups."
}
]
},
{
"question": "A developer wants to share an S3 bucket name created in a `base-infra` stack with an `application` stack in the same account and region. What is the correct approach?",
"answers": [
{
"answer": "Use Fn::GetAtt in the application stack to reference the bucket directly.",
"isCorrect": false,
"explanation": "Fn::GetAtt can only reference resources within the same template, not resources in another stack."
},
{
"answer": "Export the bucket name in the Outputs section of the base-infra stack, then use Fn::ImportValue in the application stack.",
"isCorrect": true,
"explanation": "Cross-stack references work by exporting a value with an Export name in the Outputs section, then importing it with Fn::ImportValue in another stack within the same account and region."
},
{
"answer": "Use Fn::FindInMap in the application stack with a reference to the base-infra stack.",
"isCorrect": false,
"explanation": "Fn::FindInMap only looks up values within the same template's Mappings section and cannot reference other stacks."
},
{
"answer": "Pass the bucket name as a hardcoded Parameter in the application stack template.",
"isCorrect": false,
"explanation": "While possible, hardcoding values eliminates the benefit of automation and cross-stack references, and introduces a manual dependency."
}
]
},
{
"question": "Before applying an update to a production CloudFormation stack, a developer wants to review exactly which resources will be added, modified, or replaced. What feature should they use?",
"answers": [
{
"answer": "Stack Policy",
"isCorrect": false,
"explanation": "A stack policy controls which resources can be updated or replaced, but it does not preview the changes before applying them."
},
{
"answer": "Drift Detection",
"isCorrect": false,
"explanation": "Drift detection identifies configuration differences between a running stack and its template, but it does not preview the impact of a new template update."
},
{
"answer": "Change Set",
"isCorrect": true,
"explanation": "A change set previews exactly which resources will be added, modified, or replaced when a new template is applied, without executing any changes. It is the recommended practice before production updates."
},
{
"answer": "Nested Stack",
"isCorrect": false,
"explanation": "Nested stacks are a way to compose infrastructure from reusable child stacks, not a mechanism for previewing updates."
}
]
},
{
"question": "A CloudFormation stack has an RDS database defined with no DeletionPolicy set. What happens to the database when the stack is deleted?",
"answers": [
{
"answer": "The database is retained in the account with no data loss.",
"isCorrect": false,
"explanation": "Retain behavior only occurs if DeletionPolicy: Retain is explicitly set. Without it, the default behavior applies."
},
{
"answer": "CloudFormation automatically takes a snapshot before deleting the database.",
"isCorrect": false,
"explanation": "Automatic snapshots only occur if DeletionPolicy: Snapshot is explicitly configured. This is not the default behavior."
},
{
"answer": "The database is deleted by CloudFormation.",
"isCorrect": true,
"explanation": "The default DeletionPolicy is Delete. Without an explicit override, CloudFormation deletes the underlying resource when the resource is removed from the template or the stack is deleted."
},
{
"answer": "CloudFormation prompts the user to choose what to do with the database.",
"isCorrect": false,
"explanation": "CloudFormation does not interactively prompt users during stack deletion. It follows the DeletionPolicy defined in the template, defaulting to Delete."
}
]
},
{
"question": "Which DeletionPolicy values are valid in AWS CloudFormation? (Select TWO)",
"answers": [
{
"answer": "Retain",
"isCorrect": true,
"explanation": "Retain is a valid DeletionPolicy that leaves the resource in place when the stack is deleted or the resource is removed from the template."
},
{
"answer": "Snapshot",
"isCorrect": true,
"explanation": "Snapshot is a valid DeletionPolicy supported for resources like RDS and ElastiCache. It takes a final snapshot before deleting the resource."
},
{
"answer": "Archive",
"isCorrect": false,
"explanation": "Archive is not a valid CloudFormation DeletionPolicy. The valid options are Delete, Retain, and Snapshot."
},
{
"answer": "Backup",
"isCorrect": false,
"explanation": "Backup is not a valid CloudFormation DeletionPolicy. The valid options are Delete, Retain, and Snapshot."
},
{
"answer": "Delete",
"isCorrect": true,
"explanation": "Delete is the default DeletionPolicy. When set (or by default), CloudFormation deletes the resource when it is removed from the template or the stack is destroyed."
}
]
},
{
"question": "A developer configures a CloudFormation stack to launch an EC2 instance and install a web server on it. After the stack creation, they notice CloudFormation marked the instance as CREATE_COMPLETE before the web server installation had finished. What should they implement to fix this?",
"answers": [
{
"answer": "Add a DeletionPolicy: Retain to the EC2 resource.",
"isCorrect": false,
"explanation": "DeletionPolicy controls what happens to a resource when it is deleted, not when it finishes bootstrapping."
},
{
"answer": "Use cfn-signal with a CreationPolicy on the EC2 resource.",
"isCorrect": true,
"explanation": "cfn-signal sends a success or failure signal from the instance back to CloudFormation. Combined with a CreationPolicy and a timeout, CloudFormation waits for this signal before marking the resource as CREATE_COMPLETE, ensuring the application is fully running."
},
{
"answer": "Use cfn-hup to poll for metadata changes.",
"isCorrect": false,
"explanation": "cfn-hup is a daemon used to detect metadata changes and re-run cfn-init on running instances. It does not signal CloudFormation upon initial bootstrap completion."
},
{
"answer": "Define the installation steps under the Outputs section.",
"isCorrect": false,
"explanation": "Outputs expose values after stack creation and have no role in controlling the bootstrap signaling mechanism."
}
]
},
{
"question": "What is the primary purpose of the `cfn-hup` helper script in CloudFormation?",
"answers": [
{
"answer": "To send a success or failure signal back to CloudFormation when an EC2 instance finishes bootstrapping.",
"isCorrect": false,
"explanation": "This is the role of cfn-signal, not cfn-hup."
},
{
"answer": "To read the AWS::CloudFormation::Init metadata and install packages, write files, and start services on an EC2 instance.",
"isCorrect": false,
"explanation": "This is the role of cfn-init, not cfn-hup."
},
{
"answer": "To poll for changes to the resource's CloudFormation metadata and re-run cfn-init when updates are detected.",
"isCorrect": true,
"explanation": "cfn-hup is a daemon that runs on EC2 instances and continuously polls for metadata changes. When it detects an update, it triggers cfn-init again, allowing configuration changes to be applied to running instances without replacement."
},
{
"answer": "To create a CloudFormation change set and preview infrastructure updates.",
"isCorrect": false,
"explanation": "Change sets are a CloudFormation console/API feature used to preview stack updates, not a function of the cfn-hup helper script."
}
]
},
{
"question": "An organization manages infrastructure across 15 AWS accounts and 3 regions. They want to deploy a standard logging configuration using a single CloudFormation template to all of these accounts and regions simultaneously. What is the most appropriate CloudFormation feature to use?",
"answers": [
{
"answer": "Nested Stacks",
"isCorrect": false,
"explanation": "Nested stacks decompose a large template into reusable child stacks within a single account and region. They do not support multi-account or multi-region deployment."
},
{
"answer": "StackSets",
"isCorrect": true,
"explanation": "StackSets allow you to deploy a single CloudFormation template across multiple AWS accounts and regions simultaneously, making them the ideal solution for multi-account governance scenarios."
},
{
"answer": "Cross-stack references with Fn::ImportValue",
"isCorrect": false,
"explanation": "Cross-stack references share values between stacks within the same account and region. They do not support deploying to multiple accounts or regions."
},
{
"answer": "Change Sets",
"isCorrect": false,
"explanation": "Change sets preview updates for a single stack. They do not address multi-account or multi-region deployments."
}
]
},
{
"question": "A developer needs to protect a production RDS instance in a CloudFormation stack from accidental replacement or modification during stack updates. Which feature should they use?",
"answers": [
{
"answer": "Drift Detection",
"isCorrect": false,
"explanation": "Drift detection identifies configuration differences between the live resource and the template. It does not prevent resources from being modified during updates."
},
{
"answer": "Stack Policy",
"isCorrect": true,
"explanation": "A stack policy is a JSON document that explicitly controls which resources can be updated or replaced during a stack update, making it the right tool to protect stateful resources like RDS from accidental changes."
},
{
"answer": "DeletionPolicy: Snapshot",
"isCorrect": false,
"explanation": "DeletionPolicy: Snapshot takes a snapshot before deleting the resource, but it does not prevent modifications or replacements during an update."
},
{
"answer": "CreationPolicy",
"isCorrect": false,
"explanation": "CreationPolicy is used to wait for a signal from an EC2 instance or Auto Scaling group during initial creation, not to protect resources during updates."
}
]
},
{
"question": "A CloudFormation template uses the following expression: `!Sub \"arn:aws:lambda:${AWS::Region}:${AWS::AccountId}:function:my-function\"`. What does this intrinsic function do?",
"answers": [
{
"answer": "It looks up a value from the Mappings section based on the current region and account.",
"isCorrect": false,
"explanation": "Looking up values from Mappings is done with Fn::FindInMap, not Fn::Sub."
},
{
"answer": "It performs string substitution, replacing ${AWS::Region} and ${AWS::AccountId} with their runtime values to construct the ARN dynamically.",
"isCorrect": true,
"explanation": "Fn::Sub substitutes variables in a string at deploy time. Here, AWS::Region and AWS::AccountId are pseudo-parameters that are replaced with the actual region and account ID of the deployment."
},
{
"answer": "It joins a list of values with a colon delimiter.",
"isCorrect": false,
"explanation": "Joining values with a delimiter is the purpose of Fn::Join, not Fn::Sub."
},
{
"answer": "It retrieves an attribute of the Lambda function resource.",
"isCorrect": false,
"explanation": "Retrieving resource attributes is done with Fn::GetAtt, not Fn::Sub."
}
]
},
{
"question": "A developer removes an S3 bucket resource from a CloudFormation template and updates the stack. The bucket has `DeletionPolicy: Retain`. What happens?",
"answers": [
{
"answer": "CloudFormation deletes the S3 bucket and all its contents.",
"isCorrect": false,
"explanation": "DeletionPolicy: Retain explicitly prevents CloudFormation from deleting the resource. The bucket is left in the account."
},
{
"answer": "CloudFormation takes a snapshot of the bucket before removing it.",
"isCorrect": false,
"explanation": "Snapshot is a separate DeletionPolicy option and is not applicable to S3 buckets. With Retain, no snapshot is taken — the resource is simply kept."
},
{
"answer": "CloudFormation removes the bucket from stack management but leaves it intact in the account.",
"isCorrect": true,
"explanation": "DeletionPolicy: Retain causes CloudFormation to disassociate the resource from the stack without deleting it. The S3 bucket continues to exist in the account independently."
},
{
"answer": "CloudFormation throws an error because S3 buckets cannot be removed from a template.",
"isCorrect": false,
"explanation": "CloudFormation does not throw an error in this case. DeletionPolicy: Retain is a fully supported and expected pattern for protecting resources from deletion."
}
]
},
{
"question": "Which of the following statements about cross-stack references in CloudFormation are correct? (Select TWO)",
"answers": [
{
"answer": "A stack that exports a value cannot be deleted while another stack is importing that value.",
"isCorrect": true,
"explanation": "CloudFormation enforces this dependency: if a stack's exported value is being consumed by another stack via Fn::ImportValue, the exporting stack cannot be deleted until the dependency is removed."
},
{
"answer": "Fn::ImportValue can reference exports from stacks in different AWS regions.",
"isCorrect": false,
"explanation": "Cross-stack references with Fn::ImportValue are limited to the same account and region. For cross-region sharing, other mechanisms such as SSM Parameter Store or custom resources are needed."
},
{
"answer": "Exported Output names must be unique within an account and region.",
"isCorrect": true,
"explanation": "Export names are scoped to the account and region, and must be unique across all stacks in that scope to avoid conflicts."
},
{
"answer": "Fn::ImportValue can be used to reference any resource attribute from any stack without exporting it first.",
"isCorrect": false,
"explanation": "Fn::ImportValue can only consume values that have been explicitly exported in another stack's Outputs section. There is no implicit access to other stacks' resources."
}
]
},
{
"question": "What is the difference between `DeletionPolicy` and `UpdateReplacePolicy` in CloudFormation?",
"answers": [
{
"answer": "DeletionPolicy applies when a stack or resource is deleted; UpdateReplacePolicy applies when a resource must be replaced during a stack update.",
"isCorrect": true,
"explanation": "DeletionPolicy controls what happens when a resource is explicitly deleted (stack deletion or resource removal). UpdateReplacePolicy controls what happens to the old resource when CloudFormation must replace it during an update (e.g., changing an immutable property)."
},
{
"answer": "DeletionPolicy applies during updates; UpdateReplacePolicy applies during stack deletion.",
"isCorrect": false,
"explanation": "This is the reverse of the correct behavior. DeletionPolicy applies to deletions and UpdateReplacePolicy applies to resource replacement during updates."
},
{
"answer": "They are interchangeable and have the same effect.",
"isCorrect": false,
"explanation": "They are distinct attributes that apply in different scenarios. DeletionPolicy governs deletion; UpdateReplacePolicy governs replacement during updates."
},
{
"answer": "UpdateReplacePolicy is only valid for S3 buckets and RDS instances.",
"isCorrect": false,
"explanation": "UpdateReplacePolicy can be applied to any CloudFormation resource, not just S3 or RDS."
}
]
},
{
"question": "A developer has manually changed a security group rule directly in the AWS console after it was created by CloudFormation. They want to detect this discrepancy. Which CloudFormation feature should they use?",
"answers": [
{
"answer": "Change Sets",
"isCorrect": false,
"explanation": "Change sets preview the impact of applying a new template version. They do not detect differences between the current live configuration and the existing deployed template."
},
{
"answer": "Stack Policy",
"isCorrect": false,
"explanation": "Stack policies restrict which resources can be updated during a stack update. They do not detect out-of-band configuration changes."
},
{
"answer": "Drift Detection",
"isCorrect": true,
"explanation": "Drift detection compares the actual configuration of deployed resources against what the CloudFormation template declares. It identifies resources that have been modified outside of CloudFormation, such as a manually edited security group rule."
},
{
"answer": "Nested Stacks",
"isCorrect": false,
"explanation": "Nested stacks are used to compose infrastructure from multiple reusable templates and have no relation to detecting configuration drift."
}
]
}
]
{{< /qcm >}}