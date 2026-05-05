---
title: "Building a Secrets Rotation Lambda Function for RDS: Step-by-Step Implementation"
---

# Building a Secrets Rotation Lambda Function for RDS: Step-by-Step Implementation

## Introduction

Picture this: your application connects to an RDS database using a hardcoded password stored in AWS Secrets Manager. Every 30 days, you need to rotate that password to meet security compliance requirements. You could do this manually—logging into the database, updating the user's password, testing the connection, and updating Secrets Manager. Or you could automate it with a Lambda function that does all of this reliably, even when things go wrong partway through.

Secrets rotation is one of those foundational security practices that separates production-ready applications from ones that cut corners. AWS provides managed rotation for some services, but when you're working with a custom RDS instance or non-standard database setup, you'll need to implement your own rotation logic using Lambda. This article walks you through building a robust, production-grade secrets rotation function from the ground up.

We'll explore the four-step rotation process that AWS Secrets Manager expects, understand how each step fits into the bigger picture, handle failures gracefully, configure the right IAM permissions, and troubleshoot the issues you'll actually encounter in practice.

## Understanding the Four-Step Rotation Flow

Before you write a single line of code, you need to understand the choreography of secrets rotation. When Secrets Manager initiates a rotation, it calls your Lambda function with different ClientRequestToken values and Step values. Your function must implement four distinct steps, each with specific responsibilities.

**CreateSecret** is where you prepare for the upcoming change. This step creates a new version of the secret in Secrets Manager—not yet active, but staged for use. Think of it as creating a draft that hasn't been published. In the context of RDS, you might also create a temporary shadow user in the database with a new password. The key here is ensuring idempotence: if this step is called twice with the same ClientRequestToken, it should safely return without error rather than creating duplicate users.

**SetSecret** takes that new version and applies it to your actual database. This is where you execute the SQL ALTER USER command to set the new password for your application user in RDS. This step modifies the live system, so you need robust error handling. If the database is temporarily unavailable or the connection fails, you should fail gracefully so rotation can be retried.

**TestSecret** verifies that the new credentials actually work. This is your safety net—you connect to the RDS instance using the new password and run a simple query to confirm connectivity and basic functionality. If this test fails, you know something went wrong before you finalized the rotation, and you can catch the problem.

**FinishSecret** marks the new version as current in Secrets Manager and potentially cleans up the old version. This is the point of no return. Once this step completes, any code using the secret will get the new credentials. Typically, you'll also want to remove or disable the old database user so there's no stale access path.

The critical insight here is that each step must be idempotent—calling it multiple times with the same token should produce the same result, not accumulate side effects. Secrets Manager may retry steps if they fail, so your code must be prepared for that reality.

## Setting Up the Lambda Function and Execution Role

Your Lambda function needs permissions to do several things: read and write secrets from Secrets Manager, connect to your RDS instance, and write logs to CloudWatch. This means carefully crafting an IAM role with the minimum permissions required.

Start by creating an IAM role for your Lambda function. The role needs a policy allowing it to update secret metadata in Secrets Manager. Here's a policy that grants the essentials:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:UpdateSecretVersionStage"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds/mydb/appuser-*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/*"
    }
  ]
}
```

The Secrets Manager permissions let your function read the current secret, create new versions, and update the version stage—exactly what rotation requires. The CloudWatch Logs permissions enable debugging, which you'll appreciate when things go sideways.

If your RDS instance is in a VPC, your Lambda function must also run within that VPC. Configure your function with the same security group and subnet that your application uses to reach the database. Additionally, you'll need to attach an outbound security group rule allowing traffic to port 3306 (MySQL) or 5432 (PostgreSQL) depending on your database engine.

Finally, consider using a Lambda Layer to share database connection libraries. This keeps your function code focused on rotation logic rather than connection boilerplate. A layer containing `pymysql` or `psycopg2` saves you from packaging these dependencies with every function update.

## Implementing CreateSecret: Preparing for Rotation

The CreateSecret step runs first and sets up the new secret version. Here's where you create the new credential that will soon be applied to your database.

```python
def create_secret(service_client, secret_id, client_request_token):
    """
    Create a new secret version with a rotated password.
    """
    # Check if a version already exists for this token (idempotency)
    try:
        metadata = service_client.describe_secret(SecretId=secret_id)
        version = next(
            (v for v in metadata.get('VersionIdsToStages', {}).items() 
             if client_request_token in v),
            None
        )
        if version:
            logger.info(f"Secret version {client_request_token} already exists")
            return
    except service_client.exceptions.ResourceNotFoundException:
        logger.info(f"Secret {secret_id} not found, creating new")
    
    # Get the current secret to use as a template
    current_secret = service_client.get_secret_value(
        SecretId=secret_id,
        VersionStage='AWSCURRENT'
    )
    
    secret_dict = json.loads(current_secret['SecretString'])
    
    # Generate a new password
    new_password = service_client.get_random_password(
        PasswordLength=32,
        ExcludeCharacters='/@"\'\\\'
    )['RandomPassword']
    
    # Create a new version with the rotated password
    secret_dict['password'] = new_password
    
    service_client.put_secret_value(
        SecretId=secret_id,
        ClientRequestToken=client_request_token,
        SecretString=json.dumps(secret_dict),
        VersionStages=['AWSPENDING']
    )
    
    logger.info(f"Created new secret version {client_request_token}")
```

This implementation checks for idempotency by verifying whether a version with this token already exists. If it does, we skip creation. If not, we fetch the current secret, generate a new password using Secrets Manager's built-in random password generator, and create a new version staged as AWSPENDING. This new version isn't active yet—it's waiting in the wings for the subsequent steps to apply it.

The ClientRequestToken is crucial here. AWS Secrets Manager uses it to track rotation attempts, and you use it to ensure idempotency. If CreateSecret is called twice with the same token, the second call should recognize that and exit early rather than creating duplicate versions.

## Implementing SetSecret: Applying the New Credentials to RDS

SetSecret does the real work—it connects to your RDS instance and changes the database user's password. This is where things can break, and you need solid error handling.

```python
def set_secret(service_client, secret_id, client_request_token, db_connection):
    """
    Set the password in the database for the new secret version.
    """
    # Get the pending secret version
    pending_secret = service_client.get_secret_value(
        SecretId=secret_id,
        VersionId=client_request_token,
        VersionStage='AWSPENDING'
    )
    
    secret_dict = json.loads(pending_secret['SecretString'])
    
    # Get the current secret to determine the username
    current_secret = service_client.get_secret_value(
        SecretId=secret_id,
        VersionStage='AWSCURRENT'
    )
    
    current_dict = json.loads(current_secret['SecretString'])
    
    # Connect using current credentials
    username = current_dict['username']
    new_password = secret_dict['password']
    
    try:
        cursor = db_connection.cursor()
        
        # Escape the password properly to avoid SQL injection
        # For MySQL, use backticks for identifiers and quoted strings for passwords
        escaped_password = new_password.replace("'", "''")
        
        alter_user_sql = f"ALTER USER '{username}'@'%' IDENTIFIED BY '{escaped_password}'"
        cursor.execute(alter_user_sql)
        
        db_connection.commit()
        logger.info(f"Successfully set password for user {username}")
        
    except Exception as e:
        db_connection.rollback()
        logger.error(f"Failed to set secret in database: {str(e)}")
        raise
    finally:
        cursor.close()
```

A few critical points here: First, you fetch both the pending (new) secret and the current secret. The pending secret contains the new password you want to set, while the current secret tells you which user to update. This separation is important because you're not changing the username, just the password.

Second, notice the SQL escaping. Never concatenate passwords directly into SQL queries—that invites injection vulnerabilities. For MySQL, we escape single quotes by doubling them. For PostgreSQL, you'd use parameterized queries with the psycopg2 driver.

Third, commit and rollback logic matters. If the ALTER USER command fails, we rollback the transaction and raise an exception. This failure propagates up to Lambda's runtime, which can trigger a retry or mark the rotation as failed.

## Implementing TestSecret: Verifying the New Credentials

TestSecret is your verification step. You connect to the database using only the new credentials—not the old ones—and execute a simple query. If this succeeds, you know the new password works.

```python
def test_secret(service_client, secret_id, client_request_token, db_host, db_engine):
    """
    Test that the new secret version allows successful database connection.
    """
    # Get the pending secret version
    pending_secret = service_client.get_secret_value(
        SecretId=secret_id,
        VersionId=client_request_token,
        VersionStage='AWSPENDING'
    )
    
    secret_dict = json.loads(pending_secret['SecretString'])
    
    username = secret_dict['username']
    password = secret_dict['password']
    port = secret_dict.get('port', 3306 if db_engine == 'mysql' else 5432)
    
    try:
        if db_engine == 'mysql':
            import pymysql
            test_connection = pymysql.connect(
                host=db_host,
                user=username,
                password=password,
                port=port,
                connect_timeout=5
            )
        elif db_engine == 'postgresql':
            import psycopg2
            test_connection = psycopg2.connect(
                host=db_host,
                user=username,
                password=password,
                port=port,
                connect_timeout=5
            )
        
        cursor = test_connection.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        cursor.close()
        test_connection.close()
        
        logger.info(f"Successfully tested connection with new credentials")
        
    except Exception as e:
        logger.error(f"Failed to test secret: {str(e)}")
        raise
```

The critical difference here is that you're creating a brand-new connection using only the new credentials. You're not reusing any existing connection. This ensures that the new password actually works for authentication, not just for changing a user's settings.

The connect_timeout parameter is important. If your RDS instance is unreachable or the security group rules are incorrect, you want to fail fast rather than hanging for 30 seconds. A 5-second timeout gives you reasonable time to detect issues without making rotation unnecessarily slow.

## Implementing FinishSecret: Making the Rotation Official

FinishSecret is the final step—you update Secrets Manager to mark the new version as current. This is when applications using the secret will start getting the new credentials.

```python
def finish_secret(service_client, secret_id, client_request_token):
    """
    Finalize the rotation by marking the new version as current.
    """
    metadata = service_client.describe_secret(SecretId=secret_id)
    
    current_version = None
    for version, stages in metadata['VersionIdsToStages'].items():
        if 'AWSCURRENT' in stages:
            if version == client_request_token:
                logger.info(f"Version {client_request_token} already marked as AWSCURRENT")
                return
            current_version = version
            break
    
    # Move the AWSPENDING label to AWSCURRENT
    service_client.update_secret_version_stage(
        SecretId=secret_id,
        VersionStage='AWSCURRENT',
        MoveToVersionId=client_request_token,
        RemoveFromVersionId=current_version
    )
    
    logger.info(f"Successfully rotated secret to version {client_request_token}")
```

This step uses the UpdateSecretVersionStage API to atomically move the AWSCURRENT label from the old version to the new one. Once this completes, any code calling GetSecretValue without specifying a version will receive the new credentials.

Note the idempotency check at the start: if FinishSecret is called twice with the same token, we simply return because the version is already marked as current. This protects against accidental double-application.

You might also consider adding logic to remove the AWSPREVIOUS label if you want to clean up old versions, but many teams keep a few previous versions for debugging purposes.

## Wiring Everything Together: The Complete Lambda Handler

Here's how these four steps come together in your Lambda handler:

```python
import json
import logging
import os
import pymysql
import psycopg2
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

secrets_client = boto3.client('secretsmanager')

def get_db_connection(secret_dict, db_engine):
    """
    Create a database connection using credentials from the secret.
    """
    db_host = secret_dict['host']
    username = secret_dict['username']
    password = secret_dict['password']
    port = secret_dict.get('port', 3306 if db_engine == 'mysql' else 5432)
    
    try:
        if db_engine == 'mysql':
            connection = pymysql.connect(
                host=db_host,
                user=username,
                password=password,
                port=port,
                connect_timeout=5
            )
        elif db_engine == 'postgresql':
            connection = psycopg2.connect(
                host=db_host,
                user=username,
                password=password,
                port=port,
                connect_timeout=5
            )
        else:
            raise ValueError(f"Unsupported database engine: {db_engine}")
        
        return connection
    except Exception as e:
        logger.error(f"Failed to connect to database: {str(e)}")
        raise

def lambda_handler(event, context):
    """
    Main Lambda handler for secrets rotation.
    """
    service_client = boto3.client('secretsmanager')
    
    secret_id = event['SecretId']
    client_request_token = event['ClientRequestToken']
    step = event['Step']
    
    # Get database engine from environment variable or secret metadata
    db_engine = os.environ.get('DB_ENGINE', 'mysql')
    db_host = None
    
    # Fetch the secret to get database host
    try:
        secret_response = service_client.get_secret_value(
            SecretId=secret_id
        )
        secret_dict = json.loads(secret_response['SecretString'])
        db_host = secret_dict.get('host')
    except ClientError as e:
        logger.error(f"Error retrieving secret {secret_id}: {str(e)}")
        raise
    
    try:
        if step == 'create':
            create_secret(service_client, secret_id, client_request_token)
        
        elif step == 'set':
            # Get current credentials to connect to database
            current_secret = service_client.get_secret_value(
                SecretId=secret_id,
                VersionStage='AWSCURRENT'
            )
            current_dict = json.loads(current_secret['SecretString'])
            
            db_connection = get_db_connection(current_dict, db_engine)
            try:
                set_secret(service_client, secret_id, client_request_token, db_connection)
            finally:
                db_connection.close()
        
        elif step == 'test':
            test_secret(service_client, secret_id, client_request_token, db_host, db_engine)
        
        elif step == 'finish':
            finish_secret(service_client, secret_id, client_request_token)
        
        else:
            raise ValueError(f"Invalid step: {step}")
        
        logger.info(f"Successfully executed {step} step for secret {secret_id}")
        return {
            'statusCode': 200,
            'body': json.dumps(f"{step} step completed successfully")
        }
    
    except Exception as e:
        logger.error(f"Error during {step} step: {str(e)}")
        raise
```

This handler orchestrates the four steps, managing database connections and error handling. Notice that the SetSecret step uses the AWSCURRENT credentials to connect (the old password), then uses that connection to change the password in the database. This is intentional—you need valid current credentials to execute the ALTER USER command.

## Handling Failures and Rollback Scenarios

Secrets rotation is inherently risky because you're changing authentication credentials on a live system. What happens when things go wrong?

Suppose SetSecret fails because the database is temporarily unavailable. Your Lambda function raises an exception, and Secrets Manager catches it. The failed version remains staged as AWSPENDING, but it never becomes AWSCURRENT. Your applications continue using the old credentials, and the next rotation attempt (which Secrets Manager will retry automatically) tries again.

This is actually good behavior—you want rotation to fail loudly rather than silently corrupt your credentials. However, you need to consider what happens to the shadow user you might have created in the CreateSecret step. If you created a temporary user with the new password and SetSecret fails, that shadow user still exists in the database but isn't being used. On the next rotation attempt, CreateSecret runs again. For idempotency, it should recognize that a version with this token already exists and skip user creation.

One approach is to not create a shadow user at all—just let CreateSecret create the new secret version in Secrets Manager, then have SetSecret handle all database changes. This simplifies idempotency logic significantly.

Another pattern is to use a two-user approach: maintain both an active user and a shadow user. During rotation, you create a new shadow user, test it, then atomically switch roles. This eliminates the window where no user has the current password. However, it's more complex and may not be necessary depending on your application's tolerance for rotation.

For most cases, the straightforward approach works well: CreateSecret stages a new credential, SetSecret applies it, TestSecret verifies it, and FinishSecret makes it official. If anything fails, the old credential remains active and you can investigate the error in CloudWatch logs.

## Managing IAM Permissions Precisely

Your Lambda function needs database access, but you probably don't want to grant it unlimited permissions. Beyond the Secrets Manager and CloudWatch permissions we discussed earlier, consider what database privileges your rotation function actually needs.

The function needs to execute ALTER USER commands, so your database user must have the appropriate privilege. In MySQL, this is typically:

```sql
GRANT ALTER USER ON *.* TO 'rotation-user'@'%';
```

In PostgreSQL:

```sql
ALTER ROLE rotation_user WITH SUPERUSER;
```

Or, more restrictively:

```sql
GRANT UPDATE ON pg_authid TO rotation_user;
```

Some teams use separate users for different purposes: one user for the application, one for rotation. This provides better auditing and lets you grant minimal privileges to each. The rotation user only needs ALTER USER permissions, not SELECT or INSERT on application tables.

From the Lambda side, use resource-level permissions in your IAM policy. Instead of allowing the function to access all secrets, restrict it to the specific secret ARN:

```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue",
    "secretsmanager:PutSecretValue",
    "secretsmanager:UpdateSecretVersionStage"
  ],
  "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:rds/mydb/appuser-*"
}
```

This grants permissions only to secrets whose name starts with `rds/mydb/appuser-`, protecting other secrets from accidental modification.

## Using Lambda Layers for Database Drivers

Lambda Layers let you package shared code and dependencies that multiple functions can use. For secrets rotation, a layer containing database drivers eliminates repetition and keeps your function code focused on rotation logic.

Create a layer structure like this:

```
python/
  lib/
    python3.11/
      site-packages/
        pymysql/
        psycopg2/
```

Zip this structure and upload it as a Lambda Layer. Then, attach the layer to your rotation function. Your handler can now import pymysql and psycopg2 without packaging them in the function's deployment package.

This matters because database drivers are sometimes large and your rotation function probably doesn't need every optimization. Using a layer keeps the function code zipfile small and focused.

## Troubleshooting Common Rotation Failures

Even with careful planning, rotation fails sometimes. Here are the most common culprits and how to diagnose them.

**"Connection timeout" errors** usually mean your Lambda function can't reach the RDS instance. Check three things: First, is your Lambda in the same VPC as the RDS instance? Second, do the security groups allow traffic between them? Your Lambda's security group must have an outbound rule allowing port 3306 (MySQL) or 5432 (PostgreSQL) to the RDS instance's security group. Third, is the RDS instance accessible at all—did someone accidentally make it not publicly accessible without updating your VPC configuration?

**"Access denied" errors** during SetSecret indicate that your database user doesn't have ALTER USER permissions. Connect to RDS manually using your rotation user's credentials and verify the grants are in place. Remember that you're connecting with the current (old) password during SetSecret, so the issue isn't with the new credentials—it's with the user who's trying to execute the ALTER USER command.

**"Secret version already exists" errors** during CreateSecret suggest your idempotency check isn't working correctly. This usually happens if you're comparing version IDs incorrectly. Check that you're comparing the ClientRequestToken against the version ID, not against some other identifier.

**"FinishSecret failed because version not in AWSPENDING stage"** typically means your TestSecret step never completed successfully, or it completed but didn't properly stage the secret. Review TestSecret's error logs to see what went wrong. Also verify that you're using the correct VersionId when fetching the pending secret.

**"RDS user doesn't have permission to change own password"** is a MySQL-specific gotcha. Some users are created with restricted privileges and can't change their own password. Verify that your rotation user has the ability to ALTER the target user:

```sql
SHOW GRANTS FOR 'rotation-user'@'%';
```

Look for `ALTER USER ON *.*` in the output.

## Integrating Rotation with Secrets Manager Configuration

Once your Lambda function is working, configure Secrets Manager to call it during rotation. In the Secrets Manager console, go to your secret, then Rotation Configuration. Specify your Lambda function, set the rotation interval (typically 30 days), and enable automatic rotation.

Secrets Manager uses an automatic rotation schedule to trigger your function at the specified interval. You can also manually trigger rotation from the console for testing. Always test rotation in a non-production environment first—use a development RDS instance with a development secret to verify all four steps work before enabling rotation on production secrets.

## Conclusion

Building a secrets rotation Lambda function is a key skill for working with AWS and RDS in production environments. The four-step process—CreateSecret, SetSecret, TestSecret, and FinishSecret—provides a structure that handles both the happy path and failure scenarios gracefully.

The implementation details matter: idempotent steps that can be retried safely, proper error handling and logging, tight IAM permissions, and careful testing of database connectivity. When rotation fails, you want CloudWatch logs that tell you exactly what went wrong, not cryptic error messages.

By following the patterns in this article—using Lambda Layers for shared dependencies, managing credentials carefully, and testing thoroughly before production deployment—you'll build rotation functions that keep your credentials fresh and your security posture strong. As your organization scales and manages hundreds of secrets, automated rotation becomes not just a nice-to-have but essential infrastructure.
