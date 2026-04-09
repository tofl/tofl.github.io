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