---
title: "DynamoDB Conditional Expressions: Syntax and Common Patterns"
---

## DynamoDB Conditional Expressions: Syntax and Common Patterns

Conditional expressions are one of the most powerful yet underutilized features in DynamoDB. They allow you to add logic directly into your write operations, ensuring that data modifications only happen when specific conditions are met. Rather than fetching an item, checking its state in your application, and then updating it—introducing race conditions and extra round trips—you can express your intent declaratively and let DynamoDB enforce it atomically. This article explores the syntax, mechanisms, and real-world patterns that make conditional expressions essential for building reliable applications on DynamoDB.

### Why Conditional Expressions Matter

Imagine you're building an e-commerce platform where order status transitions matter deeply. An order should only move from "pending" to "shipped" if it's currently in the "pending" state. Without conditional expressions, you'd need to read the item, check the status in your application logic, and then perform the update. Between those steps, another process could change the status, and your application might unknowingly corrupt the data.

With conditional expressions, you express this requirement directly in your DynamoDB call. If the condition fails, DynamoDB rejects the entire operation and returns a `ConditionalCheckFailedException`. This atomic approach eliminates entire categories of concurrency bugs and race conditions that plague naive implementations.

Conditional expressions work with `PutItem`, `UpdateItem`, `DeleteItem`, and `TransactWriteItems` operations. They're particularly valuable in microservices architectures where you can't rely on application-level locking mechanisms.

### Understanding the Syntax

Conditional expressions are written as logical statements that evaluate to true or false. DynamoDB evaluates them at execution time. If the condition is true, the operation proceeds; if false, it fails.

The expression syntax combines condition functions, comparison operators, logical operators, and references to attributes and values.

#### Condition Functions

DynamoDB provides several built-in functions for use in conditional expressions, each serving a specific purpose.

**attribute_exists(path)** checks whether an attribute is present in an item. This is useful for ensuring an item exists before updating it or preventing accidental overwrites. For example, `attribute_exists(#pk)` verifies that the attribute referenced by the expression attribute name `#pk` is present.

**attribute_not_exists(path)** is the inverse—it returns true only if an attribute is absent. This is invaluable for implementing insert-if-not-exists patterns without requiring a separate read operation.

**attribute_type(path, type)** validates that an attribute matches a specific DynamoDB type. Valid types include `S` (string), `N` (number), `B` (binary), `SS` (string set), `NS` (number set), `BS` (binary set), `M` (map), `L` (list), `NULL`, and `BOOL`. You might use this to ensure a field hasn't been corrupted or accidentally set to a different type.

**begins_with(path, substr)** checks if a string attribute starts with a given substring. This is especially useful with sort keys in composite key designs. For instance, `begins_with(#sk, :prefix)` could ensure a sort key follows an expected pattern.

**contains(path, operand)** works on strings and sets. For strings, it checks if the string contains a substring. For sets, it checks if a value exists in the set. If you're tracking tags or permissions as a string set, `contains(tags, :tag)` verifies a specific tag is present.

**size(path)** returns the length of an attribute. For strings, it's the number of characters; for sets or lists, it's the number of elements; for maps, it's the number of key-value pairs. You might use `size(userIds) > :limit` to prevent a list from growing unbounded.

#### Comparison Operators

Beyond the condition functions, you can use standard comparison operators: `=`, `<>` (not equal), `<`, `<=`, `>`, and `>=`. These work with numbers, strings, and binary values.

```
version = :expected_version
balance >= :minimum_balance
created_at < :cutoff_date
```

#### Logical Operators

You can combine conditions using `AND`, `OR`, and `NOT`. Parentheses control precedence and clarity.

```
attribute_exists(#status) AND #status = :pending
(#count < :max) OR (#status = :override)
NOT attribute_exists(#deleted_at)
```

### Expression Attribute Names and Values

DynamoDB has a list of reserved keywords—words like `status`, `data`, `name`, `type`, `size`, and many others that conflict with the DynamoDB API. You cannot use these directly in expressions without escaping them.

Expression attribute names are placeholders prefixed with a hash symbol (`#`) that map to actual attribute names. Similarly, expression attribute values are placeholders prefixed with a colon (`:`) that map to the actual values you're comparing against.

This separation also prevents injection attacks and keeps expressions cleaner.

Here's a simple example:

```python
response = dynamodb.update_item(
    TableName='Orders',
    Key={'orderId': {'S': 'order-123'}},
    UpdateExpression='SET #status = :new_status',
    ConditionExpression='#status = :current_status',
    ExpressionAttributeNames={
        '#status': 'status'
    },
    ExpressionAttributeValues={
        ':current_status': {'S': 'pending'},
        ':new_status': {'S': 'shipped'}
    }
)
```

In this example, `#status` is a placeholder for the `status` attribute, and `:current_status` and `:new_status` are placeholders for the literal values `'pending'` and `'shipped'`. Even though `status` isn't technically a reserved keyword in this case, using expression attribute names is a best practice for consistency and safety.

### Working with UpdateItem and PutItem

The `ConditionExpression` parameter accepts your conditional logic. Let's look at both `UpdateItem` and `PutItem` in detail.

#### UpdateItem with Conditions

`UpdateItem` is ideal when you're modifying specific attributes of an existing item. Adding a condition ensures the update only happens if the item is in the expected state.

Here's a practical scenario: you're decrementing inventory. You want to ensure inventory never goes negative.

```python
import boto3

dynamodb = boto3.client('dynamodb')

def decrement_inventory(product_id, quantity):
    try:
        response = dynamodb.update_item(
            TableName='Inventory',
            Key={'productId': {'S': product_id}},
            UpdateExpression='SET #qty = #qty - :amount',
            ConditionExpression='#qty >= :amount',
            ExpressionAttributeNames={
                '#qty': 'quantity'
            },
            ExpressionAttributeValues={
                ':amount': {'N': str(quantity)}
            },
            ReturnValues='ALL_NEW'
        )
        return response['Attributes']
    except dynamodb.exceptions.ConditionalCheckFailedException:
        print(f"Cannot decrement inventory for {product_id}: insufficient stock")
        return None
```

If the current quantity is less than the amount being decremented, the condition fails and the exception is raised. Your application can catch this and handle it gracefully—perhaps by rejecting the order or notifying the user.

#### PutItem with Conditions

`PutItem` completely replaces an item (or creates it if it doesn't exist). Conditions ensure you only overwrite items under specific circumstances.

A common pattern is preventing accidental overwrites of existing items:

```python
def create_user_if_not_exists(user_id, user_data):
    try:
        response = dynamodb.put_item(
            TableName='Users',
            Item={
                'userId': {'S': user_id},
                'email': {'S': user_data['email']},
                'created_at': {'N': str(int(time.time()))},
                'status': {'S': 'active'}
            },
            ConditionExpression='attribute_not_exists(userId)',
            ReturnValues='ALL_OLD'
        )
        print(f"User {user_id} created successfully")
        return True
    except dynamodb.exceptions.ConditionalCheckFailedException:
        print(f"User {user_id} already exists")
        return False
```

The condition `attribute_not_exists(userId)` ensures that if a user with this ID already exists, the `PutItem` fails. This is much safer than blindly overwriting user data.

### DeleteItem with Conditions

Similarly, you can condition a delete operation. This is useful for preventing accidental deletion of items in certain states or ensuring you're deleting the version you expect.

```python
def delete_order_if_cancelled(order_id):
    try:
        dynamodb.delete_item(
            TableName='Orders',
            Key={'orderId': {'S': order_id}},
            ConditionExpression='#status = :cancelled',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':cancelled': {'S': 'cancelled'}
            }
        )
        print(f"Order {order_id} deleted")
        return True
    except dynamodb.exceptions.ConditionalCheckFailedException:
        print(f"Cannot delete order {order_id}: not in cancelled state")
        return False
```

An order can only be deleted if it's in the "cancelled" state, preventing accidental deletion of active orders.

### TransactWriteItems with Conditions

For multi-item operations where all-or-nothing semantics are critical, `TransactWriteItems` allows you to specify a `ConditionExpression` for each item in the transaction.

Imagine transferring funds between accounts. Both the debit and credit must succeed, and you want to ensure the source account has sufficient balance.

```python
def transfer_funds(source_account_id, dest_account_id, amount):
    try:
        response = dynamodb.transact_write_items(
            TransactItems=[
                {
                    'Update': {
                        'TableName': 'Accounts',
                        'Key': {'accountId': {'S': source_account_id}},
                        'UpdateExpression': 'SET #balance = #balance - :amount',
                        'ConditionExpression': '#balance >= :amount',
                        'ExpressionAttributeNames': {'#balance': 'balance'},
                        'ExpressionAttributeValues': {':amount': {'N': str(amount)}}
                    }
                },
                {
                    'Update': {
                        'TableName': 'Accounts',
                        'Key': {'accountId': {'S': dest_account_id}},
                        'UpdateExpression': 'SET #balance = #balance + :amount',
                        'ExpressionAttributeNames': {'#balance': 'balance'},
                        'ExpressionAttributeValues': {':amount': {'N': str(amount)}}
                    }
                }
            ]
        )
        print("Transfer successful")
        return True
    except dynamodb.exceptions.ConditionalCheckFailedException as e:
        print(f"Transfer failed: {e}")
        return False
```

If the source account doesn't have enough balance, the entire transaction is rejected, and neither account is modified. This atomic all-or-nothing behavior is exactly what you need for financial operations.

### Common Patterns

Conditional expressions shine in several recurring scenarios. Let's explore the most important patterns you'll encounter.

#### Insert-If-Not-Exists

This pattern prevents duplicate entries by ensuring an item doesn't already exist before inserting it.

```python
def register_email(email):
    try:
        dynamodb.put_item(
            TableName='Emails',
            Item={
                'email': {'S': email},
                'registered_at': {'N': str(int(time.time()))}
            },
            ConditionExpression='attribute_not_exists(email)'
        )
        return {'success': True, 'message': 'Email registered'}
    except dynamodb.exceptions.ConditionalCheckFailedException:
        return {'success': False, 'message': 'Email already registered'}
```

In Node.js with the AWS SDK v3, this looks similar:

```javascript
const { DynamoDBClient, PutCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });

async function registerEmail(email) {
    try {
        await client.send(new PutCommand({
            TableName: 'Emails',
            Item: {
                email: { S: email },
                registered_at: { N: String(Math.floor(Date.now() / 1000)) }
            },
            ConditionExpression: 'attribute_not_exists(email)'
        }));
        return { success: true, message: 'Email registered' };
    } catch (error) {
        if (error.name === 'ConditionalCheckFailedException') {
            return { success: false, message: 'Email already registered' };
        }
        throw error;
    }
}
```

This pattern eliminates the need for a separate read operation to check if the email exists, improving performance and reducing race conditions.

#### Optimistic Locking with Version Numbers

When multiple clients might update the same item, optimistic locking prevents lost updates. Each item has a version number that increments with every update. An update only succeeds if the version number matches what the client expects.

```python
def update_profile(user_id, current_version, new_bio):
    try:
        response = dynamodb.update_item(
            TableName='Users',
            Key={'userId': {'S': user_id}},
            UpdateExpression='SET #bio = :bio, #version = #version + :inc',
            ConditionExpression='#version = :current_version',
            ExpressionAttributeNames={
                '#bio': 'bio',
                '#version': 'version'
            },
            ExpressionAttributeValues={
                ':bio': {'S': new_bio},
                ':current_version': {'N': str(current_version)},
                ':inc': {'N': '1'}
            },
            ReturnValues='ALL_NEW'
        )
        return {'success': True, 'item': response['Attributes']}
    except dynamodb.exceptions.ConditionalCheckFailedException:
        return {'success': False, 'message': 'Version mismatch: item was modified'}
```

When a client reads a user profile, they see version 5. They make changes and attempt to update with the condition that the version is still 5. If another process has incremented the version in the meantime, the update fails, and the client knows to re-read the item and retry. This approach is far safer than blind updates in concurrent environments.

#### Enforcing State Transitions

Many applications have entities with well-defined state machines. Orders move from pending → processing → shipped → delivered. Payments move from pending → authorized → captured → settled. Conditional expressions ensure transitions only happen in valid sequences.

```python
def process_payment(payment_id, from_state, to_state):
    valid_transitions = {
        'pending': ['authorized', 'failed'],
        'authorized': ['captured', 'declined'],
        'captured': ['settled', 'refunded'],
        'settled': ['refunded'],
        'failed': [],
        'declined': [],
        'refunded': []
    }
    
    if to_state not in valid_transitions.get(from_state, []):
        return {'success': False, 'message': f'Invalid transition: {from_state} -> {to_state}'}
    
    try:
        response = dynamodb.update_item(
            TableName='Payments',
            Key={'paymentId': {'S': payment_id}},
            UpdateExpression='SET #state = :to_state, updated_at = :timestamp',
            ConditionExpression='#state = :from_state',
            ExpressionAttributeNames={'#state': 'state'},
            ExpressionAttributeValues={
                ':from_state': {'S': from_state},
                ':to_state': {'S': to_state},
                ':timestamp': {'N': str(int(time.time()))}
            },
            ReturnValues='ALL_NEW'
        )
        return {'success': True, 'item': response['Attributes']}
    except dynamodb.exceptions.ConditionalCheckFailedException:
        return {'success': False, 'message': f'Current state is not {from_state}'}
```

By explicitly checking the current state before allowing a transition, you prevent invalid state changes that could leave your system in an inconsistent state.

#### Atomic Counters with Minimum Values

Some applications need to track counters (like retry counts or failure counts) but with constraints. For example, you might want to ensure a retry counter doesn't exceed a maximum or that a balance never goes below zero.

```python
def increment_retry_count(task_id, max_retries):
    try:
        response = dynamodb.update_item(
            TableName='Tasks',
            Key={'taskId': {'S': task_id}},
            UpdateExpression='SET retry_count = if_not_exists(retry_count, :zero) + :one',
            ConditionExpression='if_not_exists(retry_count, :zero) < :max_retries',
            ExpressionAttributeValues={
                ':zero': {'N': '0'},
                ':one': {'N': '1'},
                ':max_retries': {'N': str(max_retries)}
            },
            ReturnValues='ALL_NEW'
        )
        return response['Attributes']
    except dynamodb.exceptions.ConditionalCheckFailedException:
        print(f"Task {task_id} exceeded max retries ({max_retries})")
        return None
```

The condition ensures the retry count never reaches the maximum before incrementing it. Once it does, further increments are rejected, allowing your application to move the task to a failure state or escalate it appropriately.

#### Membership Testing with Sets

Sets in DynamoDB can store multiple values, and the `contains()` function checks membership. This is useful for enforcing constraints on collections like user roles, permissions, or tags.

```python
def add_role_if_authorized(user_id, new_role, admin_roles):
    try:
        response = dynamodb.update_item(
            TableName='Users',
            Key={'userId': {'S': user_id}},
            UpdateExpression='ADD roles :new_role',
            ConditionExpression='contains(admin_roles, :current_role)',
            ExpressionAttributeValues={
                ':new_role': {'SS': [new_role]},
                ':current_role': {'S': 'admin'}
            },
            ReturnValues='ALL_NEW'
        )
        return response['Attributes']
    except dynamodb.exceptions.ConditionalCheckFailedException:
        return None
```

Here, you only add a role to a user if the current user performing the action has 'admin' in their roles set. This prevents unauthorized privilege escalation.

### Handling ConditionalCheckFailedException

When a condition fails, DynamoDB raises a `ConditionalCheckFailedException`. The way you handle this exception depends on your application logic.

In Python, catching the exception is straightforward:

```python
from botocore.exceptions import ClientError

try:
    dynamodb.update_item(...)
except ClientError as e:
    if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
        print("Condition failed")
    else:
        raise
```

In Node.js:

```javascript
try {
    await client.send(new UpdateCommand(...));
} catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
        console.log('Condition failed');
    } else {
        throw error;
    }
}
```

When a condition fails, your item is not modified at all. This is guaranteed atomically. Your application should implement a retry strategy if appropriate. For insert-if-not-exists patterns, a failed condition often means the item already exists, and you should read it to understand the current state. For optimistic locking, a failed condition signals a version mismatch, and you should re-read the item and retry.

### Performance and Cost Considerations

Conditional expressions are evaluated by DynamoDB at write time. They don't add extra network round trips or latency compared to unconditional writes—DynamoDB evaluates the condition and applies the update atomically within the same operation. However, a failed condition still consumes write capacity. If your application frequently encounters condition failures, you might want to reconsider your design or add client-side validation to reduce wasteful failed attempts.

Conditional expressions are also available in batch operations like `BatchWriteItem`, though with some limitations. Each item in a batch can have its own condition, but if any condition fails, that specific item write is rejected while others in the batch proceed.

### Advanced Scenarios

As you grow more comfortable with conditional expressions, you'll encounter scenarios requiring more sophisticated logic.

**Combining Multiple Conditions**: You can create complex conditions using `AND`, `OR`, and `NOT` operators. However, keep in mind that DynamoDB evaluates conditions synchronously before applying updates. Extremely complex conditions might impact performance, though in practice, this is rarely a concern.

**Conditional Deletes**: Deleting an item only if it's in a specific state prevents accidental data loss. This is common in soft-delete implementations where you mark an item as deleted rather than removing it entirely.

**Cross-Item Consistency**: While DynamoDB's conditional expressions work within a single item, `TransactWriteItems` extends this to multiple items. You can condition updates on different items and ensure all-or-nothing semantics across them.

**Handling Large Values**: Expression attribute values are limited in size, and complex nested structures in the value can affect performance. For large items, keep conditions focused on key attributes rather than attempting to condition on deeply nested values.

### Best Practices

Write expression attribute names and values consistently. Always use them, even when not strictly necessary, to avoid reserved keyword issues and maintain consistency across your codebase. This makes your code more maintainable and less prone to surprises when reserved keywords are introduced or when you refactor attribute names.

Document your conditional logic. A comment explaining why a condition exists helps future developers understand the business rules being enforced. Without context, a condition like `#status = :pending` might seem arbitrary.

Test condition failures explicitly. Write tests that verify your application handles `ConditionalCheckFailedException` correctly. A common bug is catching the exception but not handling it appropriately, which can mask data inconsistency issues.

Avoid overly complex conditions. If a condition becomes hard to read or spans multiple operators and logical gates, consider breaking the operation into multiple simpler steps or reevaluating your data model. Readable conditions are maintainable conditions.

### Conclusion

Conditional expressions transform DynamoDB from a simple key-value store into a powerful tool for enforcing application invariants at the database level. By moving validation and state-checking logic into your write operations, you eliminate race conditions, reduce round trips, and achieve atomic semantics that are difficult to replicate at the application layer.

Whether you're implementing insert-if-not-exists patterns, optimistic locking with version numbers, enforcing state machines, or protecting counters from invalid values, conditional expressions provide the declarative power to express your intent clearly and let DynamoDB handle the complexity. As you build increasingly sophisticated applications, mastering conditional expressions will prove invaluable for building systems that are both fast and correct.
