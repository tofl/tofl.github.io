---
title: "CodeDeploy On-Premises Servers: Agent Installation and Activation"
---

## CodeDeploy On-Premises Servers: Agent Installation and Activation

Deploying applications to servers outside AWS has become increasingly important as organizations adopt hybrid cloud strategies. Whether you're managing infrastructure in your own data center, leveraging other cloud providers, or maintaining legacy systems, AWS CodeDeploy offers a unified way to automate deployments across these environments alongside your AWS resources.

The magic that enables this is the CodeDeploy agent—a lightweight service that runs on your servers and communicates back to AWS. Understanding how to install, configure, and activate this agent on on-premises infrastructure is essential for building robust deployment pipelines that span your entire infrastructure footprint.

### Understanding CodeDeploy's Architecture

Before diving into installation, it helps to understand how CodeDeploy differs when you step outside the AWS ecosystem. When deploying to EC2 instances, AWS handles a lot behind the scenes. An instance profile with the appropriate IAM permissions is automatically available, and EC2 metadata endpoints make authentication seamless.

On-premises servers don't have that convenience. They're not part of your VPC, they don't have EC2 instance profiles, and they can't tap into the EC2 metadata service. Instead, you need to explicitly provide credentials and register the server as a CodeDeploy resource. This creates an extra setup step, but it also gives you fine-grained control over which servers can communicate with CodeDeploy.

The CodeDeploy agent running on your on-premises server acts as a bridge. It polls CodeDeploy service endpoints, retrieves deployment instructions, executes the scripts defined in your appspec.yml, and reports back on the deployment status. This pull-based architecture means your on-premises servers initiate the connection outbound—important for understanding firewall and security group rules.

### Installing the CodeDeploy Agent

The CodeDeploy agent is available for multiple operating systems, including Amazon Linux, Ubuntu, RHEL, and Windows. The installation process varies slightly depending on your OS, but the conceptual flow is identical.

For Linux-based systems, the agent is distributed as a package and depends on Ruby being installed. Let's walk through a typical installation on an Amazon Linux or RHEL system:

```bash
sudo yum update
sudo yum install ruby wget

cd /home/ec2-user
wget https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latest/install

chmod +x ./install
sudo ./install auto
```

Replace `${REGION}` with your AWS region, such as `us-east-1`. The `auto` flag instructs the installer to detect your OS and architecture automatically.

On Ubuntu systems, the process is similar but uses `apt`:

```bash
sudo apt-get update
sudo apt-get install ruby-full wget

cd /home/ubuntu
wget https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latest/install

chmod +x ./install
sudo ./install auto
```

For Windows servers, you can download the installer and run it manually:

```powershell
$progressPreference = 'silentlyContinue'
Invoke-WebRequest -Uri "https://aws-codedeploy-${REGION}.s3.${REGION}.amazonaws.com/latest/codedeploy-agent.msi" -OutFile "C:\codedeploy-agent.msi"

cd C:\
.\codedeploy-agent.msi /quiet /norestart
```

After installation, verify that the service is running. On Linux:

```bash
sudo systemctl status codedeploy-agent
```

On Windows:

```powershell
Get-Service -Name codedeployagent
```

If the agent isn't running, start it with `sudo systemctl start codedeploy-agent` on Linux or `Start-Service -Name codedeployagent` on Windows.

### Configuring IAM Credentials

This is where on-premises deployments diverge significantly from EC2 deployments. Your on-premises server needs credentials to authenticate with the CodeDeploy service. You have two primary options: use an IAM user with programmatic access, or set up a service role and rely on temporary credentials (available only in certain configurations).

The IAM user approach is most common for on-premises servers. Create an IAM user specifically for your CodeDeploy agent and attach a policy that grants the necessary permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codedeploy:PutLifecycleEventHookExecutionStatus",
        "codedeploy:GetDeploymentConfig",
        "codedeploy:GetApplicationRevision",
        "codedeploy:DescribeApplicationRevision",
        "codedeploy:GetDeployment",
        "codedeploy:CreateDeploymentStatus",
        "codedeploy:RegisterOnPremisesInstance",
        "codedeploy:BatchGetApplicationRevisions",
        "codedeploy:BatchGetOnPremisesInstances",
        "codedeploy:GetOnPremisesInstance",
        "codedeploy:ListApplicationRevisions",
        "codedeploy:ListDeployments",
        "ec2:DescribeInstances"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::codedeploy-artifacts",
        "arn:aws:s3:::codedeploy-artifacts/*"
      ]
    }
  ]
}
```

Note that `s3:GetObject` and `s3:ListBucket` permissions are required if your application revisions are stored in S3—which is the typical workflow. Adjust the S3 ARN to match your actual artifact bucket.

Generate an access key and secret access key for this IAM user. Then, configure the CodeDeploy agent with these credentials by editing the agent configuration file. On Linux, this is typically `/etc/codedeploy-agent/conf.onpremises.json`:

```json
{
  "region": "us-east-1",
  "on_premises_config": {
    "auth_type": "iam_user",
    "iam_user_arn": "arn:aws:iam::123456789012:user/CodeDeployUser",
    "instance_arn": "arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0"
  }
}
```

Wait—that instance ARN format looks like an EC2 instance, and that's because initially it is a placeholder. You'll update this after you register the on-premises instance.

On Windows, the configuration is stored in the registry or in a configuration file in the CodeDeploy agent directory. The process is conceptually identical: provide the region, specify IAM user authentication, and include the instance ARN.

Place the access key and secret access key in standard AWS credential locations. On Linux, you can use the `~/.aws/credentials` file:

```
[default]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

Alternatively, if you're in an environment where passing credentials through configuration files isn't ideal, you can provide them via environment variables: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

### Registering On-Premises Instances

Before CodeDeploy can orchestrate deployments to your server, you must register it as an on-premises instance. This registration process associates your physical or virtual server with your AWS account and assigns it an on-premises instance tag—a unique identifier that CodeDeploy uses to target deployments.

Registration requires the CodeDeploy agent to be installed and credentials to be configured, but the agent doesn't need to be running yet. You perform registration using the AWS CLI on the on-premises server itself:

```bash
aws deploy register-on-premises-instance \
  --instance-name my-production-server \
  --instance-arn arn:aws:ec2:us-east-1:123456789012:instance/my-production-server \
  --tags "Environment=Production" "Team=Backend"
```

The `--instance-name` is a friendly name for your server. The `--instance-arn` follows a specific format for on-premises instances. AWS recommends using the format `arn:aws:ec2:region:account-id:instance/instance-name`, where `instance-name` matches your `--instance-name` parameter. This is important: the instance ARN doesn't reference an actual EC2 instance—it's just a standardized ARN format for uniquely identifying your on-premises server within CodeDeploy.

The `--tags` parameter is crucial. These tags are how you'll target deployments to specific servers. You might use tags like `Environment=Production`, `Region=DataCenter1`, or `AppName=WebServer`. Tags enable you to create deployment groups that automatically include servers matching certain criteria, similar to how you'd use EC2 tags with CodeDeploy on AWS.

After registration succeeds, update the CodeDeploy agent configuration file with the correct instance ARN. On Linux, edit `/etc/codedeploy-agent/conf.onpremises.json` again:

```json
{
  "region": "us-east-1",
  "on_premises_config": {
    "auth_type": "iam_user",
    "iam_user_arn": "arn:aws:iam::123456789012:user/CodeDeployUser",
    "instance_arn": "arn:aws:ec2:us-east-1:123456789012:instance/my-production-server"
  }
}
```

Now start the CodeDeploy agent:

```bash
sudo systemctl start codedeploy-agent
```

The agent should begin polling CodeDeploy service endpoints. You can verify registration was successful by querying CodeDeploy:

```bash
aws deploy get-on-premises-instance --instance-arn arn:aws:ec2:us-east-1:123456789012:instance/my-production-server
```

The output should show your instance with a status of `Ready` once the agent has successfully connected.

### Network and Security Considerations

For your on-premises server to communicate with CodeDeploy, outbound network connectivity to AWS CodeDeploy endpoints is essential. CodeDeploy service endpoints live in specific regions and use HTTPS (port 443). Your on-premises server must have outbound access to these endpoints.

If your on-premises infrastructure uses firewalls or network security groups, ensure that outbound traffic on port 443 to CodeDeploy endpoints is allowed. The specific endpoint hostnames depend on your region. For example, in `us-east-1`, the CodeDeploy endpoint is `codedeploy.us-east-1.amazonaws.com`. Your firewall rules should permit HTTPS traffic to the CodeDeploy endpoint for your region.

Additionally, if your application artifacts are stored in S3, your server needs outbound connectivity to S3 endpoints as well. This is typically also on port 443 using HTTPS.

If you're deploying from a private network that lacks direct internet access, consider using AWS VPN or AWS Direct Connect to establish a secure tunnel to AWS. Alternatively, if you're using a proxy or NAT gateway to route traffic, ensure that proxy authentication credentials are configured on your CodeDeploy agent if needed.

For servers behind HTTP proxies, CodeDeploy agent supports proxy configuration. On Linux, this is typically configured in `/etc/codedeploy-agent/conf.onpremises.json`:

```json
{
  "region": "us-east-1",
  "on_premises_config": {
    "auth_type": "iam_user",
    "iam_user_arn": "arn:aws:iam::123456789012:user/CodeDeployUser",
    "instance_arn": "arn:aws:ec2:us-east-1:123456789012:instance/my-production-server"
  },
  "proxy_uri": "http://proxy.example.com:8080"
}
```

If your proxy requires authentication, include the credentials in the proxy URI: `http://username:password@proxy.example.com:8080`. Be cautious with credentials in configuration files—consider restricting file permissions to ensure only the CodeDeploy agent service can read them.

### AppSpec for On-Premises Deployments

The appspec.yml file is where you define your deployment workflow, and the structure is largely the same for on-premises servers as it is for EC2 instances. However, there are a few nuances specific to on-premises deployments.

A minimal appspec.yml for an on-premises server might look like this:

```yaml
version: 0.0
Resources:
  - TargetService:
      Type: AWS::EC2::Instance
      Properties:
        Tags:
          - Key: Environment
            Value: Production
Hooks:
  BeforeInstall:
    - location: scripts/before-install.sh
      timeout: 300
      runas: root
  AfterInstall:
    - location: scripts/after-install.sh
      timeout: 300
      runas: root
  ApplicationStart:
    - location: scripts/start.sh
      timeout: 300
      runas: root
  ValidateService:
    - location: scripts/validate.sh
      timeout: 300
      runas: root
```

The Resources section defines the target for this deployment. For on-premises instances, you specify an `AWS::EC2::Instance` resource type and include tags that match the instance tags you assigned during registration. CodeDeploy will execute this appspec.yml on any on-premises instance matching these tags.

The Hooks section defines lifecycle events. Each hook specifies a script location, a timeout, and the user context (`runas`) in which the script should execute. The available lifecycle events for on-premises deployments are:

**BeforeInstall** runs before CodeDeploy starts deploying your application revision. This is where you might stop the currently running application, clear temporary files, or prepare the environment.

**AfterInstall** runs after CodeDeploy has downloaded your application revision and its dependencies. Install dependencies, set up configuration files, or run initialization scripts here.

**ApplicationStart** signals CodeDeploy to start your application. This is typically where you'd restart your service or run a startup script.

**ValidateService** runs after your application has started. Use this to perform health checks, verify that the application is responding correctly, or run smoke tests. If this hook exits with a non-zero status, the deployment is considered failed.

**BeforeAllowTraffic** and **AfterAllowTraffic** are used with load balancers to control traffic during deployment. For many on-premises scenarios, these aren't necessary, but they're useful if you're integrating with on-premises load balancers or third-party traffic management systems.

Here's a more realistic appspec.yml for a Node.js application:

```yaml
version: 0.0
Resources:
  - TargetService:
      Type: AWS::EC2::Instance
      Properties:
        Tags:
          - Key: Environment
            Value: Production
          - Key: AppName
            Value: WebServer
Files:
  - source: /
    destination: /var/www/app
Hooks:
  BeforeInstall:
    - location: scripts/stop.sh
      timeout: 180
      runas: root
  AfterInstall:
    - location: scripts/install-dependencies.sh
      timeout: 300
      runas: root
  ApplicationStart:
    - location: scripts/start.sh
      timeout: 180
      runas: root
  ValidateService:
    - location: scripts/health-check.sh
      timeout: 180
      runas: appuser
```

The Files section specifies which files from your artifact should be copied to the on-premises server. Here, everything in the root of your artifact is copied to `/var/www/app`. The source path is relative to the artifact root, and the destination is an absolute path on the target server.

Within your scripts, you have full access to environment variables that CodeDeploy injects. The `DEPLOYMENT_ID`, `LIFECYCLE_EVENT`, and `APPLICATION_NAME` variables are always available, allowing your scripts to adapt to the specific deployment context.

### Troubleshooting Common Issues

When working with on-premises CodeDeploy deployments, several common issues can arise. The CodeDeploy agent logs are your first line of investigation. On Linux, logs are typically located in `/var/log/codedeploy-agent/codedeploy-agent.log` and `/var/log/codedeploy-agent/deployments/`:

```bash
sudo tail -f /var/log/codedeploy-agent/codedeploy-agent.log
```

If the agent isn't starting, verify that Ruby is installed and that the agent service is enabled:

```bash
ruby --version
sudo systemctl enable codedeploy-agent
sudo systemctl start codedeploy-agent
```

If the agent starts but doesn't register as Ready, check the IAM credentials. Verify that the access key and secret access key are correct and that the IAM user has the necessary permissions. Test connectivity manually:

```bash
aws sts get-caller-identity
```

If this command succeeds, the credentials are valid. If it fails, double-check the credential configuration.

Connectivity issues are common with on-premises servers. Verify outbound HTTPS access to CodeDeploy endpoints:

```bash
curl -v https://codedeploy.us-east-1.amazonaws.com/
```

If this times out, you have a network connectivity issue. Check firewalls, security groups, proxies, and routing. Ensure that the region in your curl command matches the region configured in your CodeDeploy agent config.

If deployments fail, check the deployment logs. In the AWS Management Console, navigate to CodeDeploy and select your deployment. The deployment details page shows the status of each lifecycle event. Click on individual events to see their logs. If a hook script fails, the detailed output will tell you why.

Finally, ensure that the appspec.yml file is in the root of your artifact and is correctly formatted YAML. Use an online YAML validator if you're unsure about the syntax.

### Best Practices for On-Premises Deployments

When deploying to on-premises infrastructure with CodeDeploy, following a few best practices will make your deployments more reliable and your infrastructure easier to manage.

Use descriptive instance names and tags from the start. These become important as your infrastructure grows. A tag like `Environment=Production` is helpful; `Env=Prod` is not. Tags enable you to create flexible deployment groups, so invest in a consistent tagging strategy early.

Store your application artifacts in S3 and let CodeDeploy retrieve them. This is more secure and more scalable than keeping artifacts on your servers. CodeDeploy handles S3 integration seamlessly, and you benefit from S3's durability and versioning capabilities.

Implement comprehensive validation in your ValidateService hook. This is your safety net. Write scripts that verify not just that your application is running, but that it's functioning correctly. Can it reach its database? Are all required services accessible? A good health check can catch deployment issues before they affect users.

Secure your IAM credentials diligently. The access key and secret access key for your CodeDeploy IAM user are sensitive. Use a secrets management system if possible, and rotate credentials regularly. Never commit them to version control.

Monitor your CodeDeploy deployments. Use CloudWatch to track deployment success rates, hook execution times, and failure patterns. Set up alerts for failed deployments so you're notified immediately when something goes wrong.

Document your appspec.yml thoroughly with comments explaining what each hook does and why. This is especially important in on-premises environments where multiple teams might be involved in deployments.

### Conclusion

Deploying to on-premises servers using AWS CodeDeploy bridges the gap between cloud-native and hybrid infrastructure. By installing and configuring the CodeDeploy agent, providing appropriate IAM credentials, registering your servers with on-premises instance tags, and writing well-structured appspec.yml files, you can achieve consistent, automated deployments across your entire infrastructure footprint.

The key insight is that on-premises deployments require explicit credential management and network configuration that EC2 deployments handle automatically. Once you've invested in that setup, however, CodeDeploy provides a unified deployment experience that works whether you're deploying to EC2, on-premises servers, or both. This consistency is powerful—your deployment pipelines, automation scripts, and operational knowledge transfer seamlessly across your infrastructure boundaries, supporting true hybrid cloud deployments.
