---
title: "Cognito User Pool Backup and Data Export Strategies"
---

## Cognito User Pool Backup and Data Export Strategies

Every developer who's managed user authentication knows the sinking feeling of realizing how critical user data truly is. Your Cognito User Pool holds the keys to your application's identity layer—user profiles, authentication records, custom attributes, and more. Yet when you start thinking about disaster recovery, multi-region failover, or migrating to a different authentication system, you quickly discover that AWS Cognito User Pools don't offer the convenient snapshot-and-restore model that services like RDS provide. Instead, you're left to chart your own course through a landscape of APIs, CLI commands, and architectural considerations.

This article explores the practical realities of backing up and exporting Cognito User Pool data. We'll examine what you can and cannot export, how to build reliable export workflows, why password hashes present a unique challenge, and the architectural patterns that help you sleep better at night knowing your user data is protected.

### Understanding Cognito User Pool Data and Export Limitations

Before diving into solutions, let's be clear about what we're working with. A Cognito User Pool contains several categories of data: user identities (usernames, email, phone), custom attributes you define, user groups and role assignments, device records, session information, and cryptographic password hashes that Cognito manages internally.

The critical limitation to grasp immediately is this: AWS does not offer built-in snapshots for User Pools, and you cannot directly export password hashes. This isn't an oversight—it's by design. Password hashes are cryptographic material that Cognito manages using bcrypt, and exporting them would introduce security risks without meaningful benefit. If you're thinking about migrating users to another authentication system, this constraint shapes your entire strategy.

What *can* you export? User attributes, metadata, and profile information through the AWS Cognito API and CLI. This forms the foundation of any backup or migration strategy. The challenge lies in building that foundation robustly and reliably.

### Basic Export Using the AWS CLI

The most straightforward approach is leveraging the AWS CLI to list and export user information. The `admin-list-users` command lets you retrieve users from a User Pool one page at a time, returning attributes and metadata for each user.

Here's a simple example that exports all users in a pool to JSON:

```bash
aws cognito-idp admin-list-users \
  --user-pool-id us-east-1_abcdefgh \
  --region us-east-1 \
  > user_export.json
```

This command returns a paginated response with user details including username, attributes, email verified status, creation and modification timestamps, and user status. However, pagination is built-in—the response typically includes 60 users per page, and you'll need to handle the `PaginationToken` to retrieve all users.

For a more complete export that handles pagination automatically, a simple bash loop works well:

```bash
#!/bin/bash

USER_POOL_ID="us-east-1_abcdefgh"
REGION="us-east-1"
OUTPUT_FILE="all_users.json"

# Initialize output
echo "[]" > "$OUTPUT_FILE"

PAGINATION_TOKEN=""
while true; do
  # Build the command
  CMD="aws cognito-idp admin-list-users --user-pool-id $USER_POOL_ID --region $REGION --max-results 60"
  
  if [ -n "$PAGINATION_TOKEN" ]; then
    CMD="$CMD --pagination-token $PAGINATION_TOKEN"
  fi
  
  # Execute and extract users
  RESPONSE=$($CMD)
  
  # Append users to file (simplified—production code should use jq for proper JSON handling)
  echo "$RESPONSE" | jq '.Users' >> temp_users.json
  
  # Check for next page
  PAGINATION_TOKEN=$(echo "$RESPONSE" | jq -r '.PaginationToken // empty')
  
  if [ -z "$PAGINATION_TOKEN" ]; then
    break
  fi
done
```

This loop handles the pagination token automatically, ensuring you retrieve every user in the pool. The result is a JSON file containing user objects with all readable attributes.

### Building a Robust Python Export Framework

For production environments, shell scripts lack error handling, retry logic, and structured data management. A Python approach using the boto3 SDK provides better control:

```python
import boto3
import json
from datetime import datetime
from botocore.exceptions import ClientError

class CognitoUserExporter:
    def __init__(self, user_pool_id, region='us-east-1'):
        self.client = boto3.client('cognito-idp', region_name=region)
        self.user_pool_id = user_pool_id
        self.users = []
        
    def export_all_users(self, output_file=None):
        """Export all users from the User Pool with pagination handling."""
        pagination_token = None
        
        try:
            while True:
                params = {
                    'UserPoolId': self.user_pool_id,
                    'Limit': 60
                }
                
                if pagination_token:
                    params['PaginationToken'] = pagination_token
                
                response = self.client.admin_list_users(**params)
                
                for user in response.get('Users', []):
                    # Convert datetime objects to strings for JSON serialization
                    user_data = self._serialize_user(user)
                    self.users.append(user_data)
                
                print(f"Exported {len(self.users)} users so far...")
                
                # Check for next page
                pagination_token = response.get('PaginationToken')
                if not pagination_token:
                    break
                    
        except ClientError as e:
            print(f"Error exporting users: {e}")
            raise
        
        # Write to file if specified
        if output_file:
            self._write_to_file(output_file)
            print(f"Export completed. {len(self.users)} users written to {output_file}")
        
        return self.users
    
    def _serialize_user(self, user):
        """Convert user object to JSON-serializable format."""
        serialized = {
            'Username': user.get('Username'),
            'Attributes': {},
            'UserCreateDate': user.get('UserCreateDate').isoformat() if user.get('UserCreateDate') else None,
            'UserLastModifiedDate': user.get('UserLastModifiedDate').isoformat() if user.get('UserLastModifiedDate') else None,
            'Enabled': user.get('Enabled'),
            'UserStatus': user.get('UserStatus'),
            'MFAOptions': user.get('MFAOptions', [])
        }
        
        # Extract attributes
        for attr in user.get('Attributes', []):
            serialized['Attributes'][attr['Name']] = attr['Value']
        
        return serialized
    
    def _write_to_file(self, filename):
        """Write exported users to a JSON file."""
        with open(filename, 'w') as f:
            json.dump({
                'export_timestamp': datetime.now().isoformat(),
                'user_pool_id': self.user_pool_id,
                'user_count': len(self.users),
                'users': self.users
            }, f, indent=2)

# Usage
exporter = CognitoUserExporter('us-east-1_abcdefgh')
users = exporter.export_all_users('cognito_backup.json')
```

This class handles pagination transparently, converts AWS datetime objects to ISO format strings for JSON compatibility, and stores metadata about the export itself. In a production setting, you'd add retry logic with exponential backoff, logging, and perhaps integration with S3 for storage.

### Exporting User Groups and Their Memberships

User attributes alone don't tell the complete story. Many applications rely on Cognito User Groups for role-based access control. Exporting this data requires separate API calls.

```python
def export_groups_and_memberships(self):
    """Export all groups and their user memberships."""
    groups_data = {
        'groups': [],
        'memberships': []
    }
    
    try:
        # List all groups
        paginator = self.client.get_paginator('list_groups')
        page_iterator = paginator.paginate(UserPoolId=self.user_pool_id)
        
        for page in page_iterator:
            for group in page.get('Groups', []):
                group_info = {
                    'GroupName': group['GroupName'],
                    'Description': group.get('Description'),
                    'Priority': group.get('Priority'),
                    'CreationDate': group.get('CreationDate').isoformat() if group.get('CreationDate') else None,
                    'LastModifiedDate': group.get('LastModifiedDate').isoformat() if group.get('LastModifiedDate') else None
                }
                groups_data['groups'].append(group_info)
                
                # Get users in this group
                try:
                    members = self.client.get_group(
                        GroupName=group['GroupName'],
                        UserPoolId=self.user_pool_id
                    )
                    
                    for user in members.get('Users', []):
                        groups_data['memberships'].append({
                            'GroupName': group['GroupName'],
                            'Username': user['Username'],
                            'JoinDate': user.get('JoinedDate').isoformat() if user.get('JoinedDate') else None
                        })
                except ClientError as e:
                    print(f"Error retrieving members for group {group['GroupName']}: {e}")
    
    except ClientError as e:
        print(f"Error exporting groups: {e}")
        raise
    
    return groups_data
```

Group memberships are crucial for restoring users to a functional state in another User Pool. Without this information, you've preserved identities but lost their permissions context.

### The Password Hash Challenge: What It Means and Workarounds

Now we arrive at the elephant in the room. Cognito uses bcrypt to hash passwords, and AWS intentionally prevents direct export of these hashes. Why? Because password hashes are sensitive material, and exporting them wholesale creates unnecessary risk. Moreover, even if you had the hashes, migrating them to another system requires that system to use the same algorithm and parameters—and Cognito's specific bcrypt configuration may not match your destination.

This creates a fundamental problem: if you need to migrate users to a different authentication system, you cannot preserve their existing passwords. You have three realistic options.

**Option 1: Force Password Reset**

The simplest approach is to invalidate all passwords during migration and send password reset emails to every user. While disruptive, it's secure and works with any destination system. Cognito provides the `admin-set-user-password` command to set temporary passwords, which you can automate:

```python
def force_password_reset(self, username):
    """Invalidate password and force user to reset on next login."""
    try:
        self.client.admin_set_user_password(
            UserPoolId=self.user_pool_id,
            Username=username,
            Password='TempPassword123!@#',  # Will be immediately invalid
            Permanent=False  # Temporary password—forces reset on next login
        )
        print(f"Password reset initiated for {username}")
    except ClientError as e:
        print(f"Error resetting password for {username}: {e}")
```

**Option 2: Migration Lambda Trigger**

For scenarios where you're migrating users to another system but want to smooth the transition, Cognito supports a user migration Lambda trigger. When a user attempts to sign in and doesn't exist in the new User Pool, the Lambda function is invoked with their credentials. The function can then validate those credentials against your legacy system and, if valid, create the user in the new pool.

```python
# Lambda function for user migration
def lambda_handler(event, context):
    """Cognito user migration trigger."""
    
    if event['triggerSource'] == 'UserMigration_Authentication':
        # User is trying to sign in—validate against legacy system
        username = event['userName']
        password = event['password']
        
        # Call your legacy authentication system
        if validate_legacy_credentials(username, password):
            return {
                'autoConfirmUser': True,
                'autoVerifyPhone': True,
                'autoVerifyEmail': True,
                'finalUserStatus': 'CONFIRMED',
                'messageAction': 'SUPPRESS'
            }
        else:
            raise Exception('Invalid credentials')
    
    elif event['triggerSource'] == 'UserMigration_ForgotPassword':
        # Handle forgot password for migrated users
        username = event['userName']
        
        # Check if user exists in legacy system
        if user_exists_in_legacy(username):
            return {
                'autoConfirmUser': True,
                'messageAction': 'SUPPRESS'
            }
        else:
            raise Exception('User not found')
    
    return {}
```

This approach enables a gradual migration where users authenticate with their old credentials, which are validated against the legacy system while their accounts are created in the new User Pool. Over time, all users authenticate directly against Cognito.

**Option 3: Accept the Migration Friction**

Sometimes the most pragmatic approach is accepting that password migration isn't feasible and planning accordingly. Users receive a one-time password or password reset link, and they log in to set a new password. This is actually quite common in enterprise migrations and isn't as disruptive as it sounds if communicated properly.

### Scheduled Automated Backups

For ongoing protection, you need automated exports on a schedule. This ensures you always have recent data even in disaster scenarios. A Lambda function scheduled via EventBridge handles this elegantly:

```python
import boto3
import json
from datetime import datetime

s3 = boto3.client('s3')
cognito = boto3.client('cognito-idp')

def lambda_handler(event, context):
    """Scheduled backup of Cognito User Pool users to S3."""
    
    USER_POOL_ID = os.environ['USER_POOL_ID']
    BACKUP_BUCKET = os.environ['BACKUP_BUCKET']
    
    users = []
    pagination_token = None
    
    try:
        # Export all users
        while True:
            params = {
                'UserPoolId': USER_POOL_ID,
                'Limit': 60
            }
            
            if pagination_token:
                params['PaginationToken'] = pagination_token
            
            response = cognito.admin_list_users(**params)
            
            for user in response.get('Users', []):
                users.append({
                    'Username': user['Username'],
                    'Email': next((a['Value'] for a in user['Attributes'] if a['Name'] == 'email'), None),
                    'UserStatus': user['UserStatus'],
                    'CreatedAt': user['UserCreateDate'].isoformat()
                })
            
            pagination_token = response.get('PaginationToken')
            if not pagination_token:
                break
        
        # Upload to S3 with date-based prefix
        backup_key = f"cognito-backups/{datetime.now().strftime('%Y/%m/%d')}/users-{datetime.now().isoformat()}.json"
        
        s3.put_object(
            Bucket=BACKUP_BUCKET,
            Key=backup_key,
            Body=json.dumps({
                'timestamp': datetime.now().isoformat(),
                'user_count': len(users),
                'users': users
            }),
            ServerSideEncryption='AES256'
        )
        
        print(f"Backup completed: {len(users)} users stored at {backup_key}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Backup successful',
                'user_count': len(users)
            })
        }
        
    except Exception as e:
        print(f"Backup failed: {e}")
        raise
```

Deploy this with an EventBridge rule that triggers daily:

```bash
aws events put-rule \
  --name cognito-daily-backup \
  --schedule-expression "cron(2 0 * * ? *)" \
  --state ENABLED

aws events put-targets \
  --rule cognito-daily-backup \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:123456789012:function:cognito-backup","RoleArn"="arn:aws:iam::123456789012:role/EventBridgeInvokeRole"
```

This creates immutable point-in-time backups stored in S3, which you can retrieve if disaster strikes.

### Multi-Region Failover Architecture

For high-availability scenarios, many organizations replicate their Cognito User Pool across regions. Here's a practical pattern:

**Primary and Replica User Pools**: Maintain a primary User Pool in your main region and a replica in a secondary region. Your application routes to the primary under normal conditions. Backups are continuously exported to S3, and a scheduled process imports that data into the replica pool.

```python
def replicate_users_to_secondary_pool(primary_backup_s3_key, secondary_user_pool_id):
    """Import users from backup into secondary region User Pool."""
    
    s3 = boto3.client('s3')
    cognito = boto3.client('cognito-idp')
    
    # Retrieve backup from S3
    response = s3.get_object(Bucket='backup-bucket', Key=primary_backup_s3_key)
    backup_data = json.loads(response['Body'].read())
    
    imported_count = 0
    skipped_count = 0
    
    for user in backup_data['users']:
        try:
            # Build user attributes
            user_attributes = []
            for attr_name, attr_value in user['Attributes'].items():
                user_attributes.append({
                    'Name': attr_name,
                    'Value': attr_value
                })
            
            # Create user in secondary pool
            cognito.admin_create_user(
                UserPoolId=secondary_user_pool_id,
                Username=user['Username'],
                UserAttributes=user_attributes,
                MessageAction='SUPPRESS',  # Don't send invitation email
                TemporaryPassword='TempPass123!@#'
            )
            
            imported_count += 1
            
        except cognito.exceptions.UsernameExistsException:
            skipped_count += 1
        except Exception as e:
            print(f"Error importing user {user['Username']}: {e}")
    
    print(f"Replication complete: {imported_count} imported, {skipped_count} skipped")
    return imported_count, skipped_count
```

During a failover event, you update your application configuration to point to the secondary User Pool. While users will need to reset their passwords (due to the password hash limitation), their account data is preserved.

### Incremental vs. Full Exports

Full exports work well for initial backups, but as your user base grows, frequent full exports become expensive and slow. Incremental exports using LastModifiedDate are more efficient:

```python
def export_users_since(self, since_timestamp):
    """Export only users modified since a specific timestamp."""
    modified_users = []
    pagination_token = None
    
    try:
        while True:
            params = {
                'UserPoolId': self.user_pool_id,
                'Limit': 60
            }
            
            if pagination_token:
                params['PaginationToken'] = pagination_token
            
            response = self.client.admin_list_users(**params)
            
            for user in response.get('Users', []):
                user_modified = user['UserLastModifiedDate']
                
                if user_modified > since_timestamp:
                    modified_users.append(self._serialize_user(user))
            
            pagination_token = response.get('PaginationToken')
            if not pagination_token:
                break
    
    except ClientError as e:
        print(f"Error exporting modified users: {e}")
        raise
    
    return modified_users
```

Track the last export timestamp and run incremental exports hourly or more frequently. This reduces API costs and improves backup speed for large pools.

### Retention and Compliance Considerations

When designing your backup strategy, think about retention policies. Regulatory requirements like GDPR and CCPA mandate that you can delete user data upon request. This extends to backups—you cannot retain deleted users indefinitely in backup files.

Implement a process that:

1. Tracks which users have requested deletion
2. Includes that list when exporting to backups
3. Scrubs deleted users from archived backups during rotation

```python
def apply_deletion_filter(users, deleted_usernames_set):
    """Remove deleted users from export data."""
    return [u for u in users if u['Username'] not in deleted_usernames_set]

# When creating backups, filter out deleted users
deleted_users = fetch_deleted_user_list()
filtered_users = apply_deletion_filter(export_data['users'], set(deleted_users))
```

Additionally, store backups with appropriate encryption and access controls. Use S3 bucket policies to restrict access, enable versioning to prevent accidental deletion, and consider Glacier for long-term compliance archives.

### Monitoring and Testing Your Backups

A backup that's never tested is simply optimistic fiction. Implement regular restore testing to ensure your exported data can actually be reimported successfully.

```python
def validate_backup(backup_file):
    """Test that a backup can be parsed and contains expected data."""
    try:
        with open(backup_file, 'r') as f:
            backup_data = json.load(f)
        
        # Validate structure
        assert 'users' in backup_data, "Missing users array"
        assert 'export_timestamp' in backup_data, "Missing timestamp"
        assert 'user_count' in backup_data, "Missing user count"
        assert len(backup_data['users']) == backup_data['user_count'], "User count mismatch"
        
        # Validate each user
        for user in backup_data['users']:
            assert 'Username' in user, "User missing Username"
            assert 'Attributes' in user, "User missing Attributes"
        
        print(f"Backup validation passed: {backup_data['user_count']} users")
        return True
        
    except (json.JSONDecodeError, KeyError, AssertionError) as e:
        print(f"Backup validation failed: {e}")
        return False
```

Schedule this validation alongside your backups. When validation fails, alert your team immediately rather than discovering the issue during an actual disaster.

### Putting It All Together: A Complete Backup Solution

A production-ready backup solution combines automated exports, S3 storage, validation, and monitoring:

1. **Daily automated exports** via Lambda scheduled through EventBridge, storing results in S3 with date-based prefixes
2. **Hourly incremental exports** for critical user pools, capturing only modifications since the last full export
3. **Automatic validation** that checks backup integrity immediately after creation
4. **Retention policies** that delete backups older than your retention window while respecting user deletion requests
5. **CloudWatch monitoring** that alerts when exports fail or validation fails
6. **Quarterly restore testing** to a test User Pool, validating that data can be successfully reimported
7. **Disaster recovery runbook** documenting exactly how to restore from backups if needed

Together, these elements transform ad-hoc concern into systematic confidence. Your user data—the most critical asset in your identity system—is protected through multiple layers of automation and verification.

### Conclusion

Cognito User Pool backup and export isn't as straightforward as RDS snapshots, but that doesn't mean it should be left to chance. The AWS Cognito API and CLI provide everything needed to build a comprehensive backup strategy. The key is understanding the constraints—particularly around password hashes—and designing your solution with those limitations in mind.

Start with basic exports to understand your data shape, graduate to automated scheduled backups for production protection, and layer in incremental exports, validation, and multi-region replication as your requirements grow. Test your backups regularly, monitor them constantly, and document your recovery procedures. By approaching Cognito backup as a first-class concern rather than an afterthought, you'll sleep better knowing that your users' identities are protected against whatever challenges come your way.
