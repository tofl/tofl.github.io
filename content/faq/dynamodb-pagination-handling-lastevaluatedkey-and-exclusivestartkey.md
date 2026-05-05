---
title: "DynamoDB Pagination: Handling LastEvaluatedKey and ExclusiveStartKey"
---

## DynamoDB Pagination: Handling LastEvaluatedKey and ExclusiveStartKey

Working with DynamoDB at scale inevitably means dealing with large datasets. Whether you're querying user activity logs, scanning product catalogs, or retrieving historical records, you'll quickly encounter one of DynamoDB's fundamental constraints: a single Query or Scan operation can return a maximum of 1 MB of data. This limit isn't a bug—it's by design, ensuring predictable performance and preventing runaway operations from consuming excessive resources. However, it also means you need to understand pagination, and that's where LastEvaluatedKey and ExclusiveStartKey come in.

This guide walks you through the mechanics of DynamoDB pagination, from understanding the 1 MB boundary to building production-ready pagination logic that your API clients can actually use. You'll learn how to handle these response attributes, implement pagination loops in Python and Node.js, and navigate the nuances of combining pagination with filtering and limits.

### Understanding the 1 MB Response Limit

DynamoDB returns a maximum of 1 MB of data per Query or Scan operation. This limit applies to the amount of data read *before* any FilterExpression is applied. That's an important distinction: if you Query with a FilterExpression, DynamoDB reads up to 1 MB of items, applies the filter, and returns only the matching items—which might be far fewer than 1 MB of actual results.

Think of it this way: DynamoDB reads first, filters second. The 1 MB constraint is on the read phase, not the result phase. This matters for understanding why pagination is necessary even when you apply a FilterExpression.

When you hit this limit, DynamoDB doesn't throw an error. Instead, it returns a LastEvaluatedKey in the response. This key represents the position where DynamoDB stopped reading, and it's the starting point for the next request.

### LastEvaluatedKey: The Bookmark

The LastEvaluatedKey is DynamoDB's way of bookmarking your position in a dataset. When present in a response, it indicates that DynamoDB stopped reading before reaching the end of the table or query results—either because it hit the 1 MB limit or because you specified a Limit parameter that was satisfied.

This key is an opaque value that contains the exact item where DynamoDB stopped. For a simple table with only a partition key, LastEvaluatedKey would contain just that key. For a table with both a partition key and sort key, it would contain both. If you have a Global Secondary Index (GSI) involved, it also includes the base table's keys so DynamoDB can resume correctly.

Here's what a LastEvaluatedKey might look like when returned in JSON:

```json
{
  "LastEvaluatedKey": {
    "userId": { "S": "user-456" },
    "timestamp": { "N": "1672531200" }
  },
  "Items": [ /* results */ ],
  "Count": 25,
  "ScannedCount": 25
}
```

Notice the format: keys are in their DynamoDB attribute representation (with type descriptors like "S" for string, "N" for number). This is important because you'll need to pass this exact structure back to DynamoDB on your next request.

### ExclusiveStartKey: Resuming Where You Left Off

On the next Query or Scan call, you pass the LastEvaluatedKey from the previous response as the ExclusiveStartKey parameter. The name is descriptive: "exclusive" means DynamoDB starts *after* this key, not *at* this key. This prevents you from retrieving the same item twice across pagination boundaries.

Here's the conceptual flow:

1. First request: Call Query/Scan without ExclusiveStartKey. Read up to 1 MB.
2. Response includes LastEvaluatedKey if more data exists.
3. Second request: Pass that LastEvaluatedKey as ExclusiveStartKey. Resume from the next item.
4. Repeat until LastEvaluatedKey is absent from the response (indicating you've reached the end).

### Implementing Pagination in Python

Let's build a practical example using boto3. Suppose you have a table tracking user purchases, and you want to paginate through all purchases for a given user.

```python
import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('UserPurchases')

def get_all_purchases(user_id):
    """Fetch all purchases for a user, handling pagination."""
    purchases = []
    exclusive_start_key = None
    
    while True:
        # Build the query parameters
        query_params = {
            'KeyConditionExpression': Key('userId').eq(user_id),
            'Limit': 50  # Fetch 50 items per request
        }
        
        # Add ExclusiveStartKey if we're resuming
        if exclusive_start_key:
            query_params['ExclusiveStartKey'] = exclusive_start_key
        
        # Execute the query
        response = table.query(**query_params)
        
        # Add items to our collection
        purchases.extend(response['Items'])
        
        # Check if there are more results
        if 'LastEvaluatedKey' not in response:
            break
        
        # Set up for the next iteration
        exclusive_start_key = response['LastEvaluatedKey']
    
    return purchases
```

This pattern is straightforward: loop until LastEvaluatedKey disappears from the response. A few details worth highlighting:

The Limit parameter (50 in this example) controls how many items you *want* back per request, not how many you'll actually get. DynamoDB will return fewer items if it hits the 1 MB limit before reaching your Limit. It might also return fewer if your KeyConditionExpression simply doesn't match that many items. The Limit is a ceiling, not a guarantee.

If you apply a FilterExpression, the interaction becomes more complex. DynamoDB will read up to 1 MB (or your Limit, whichever is smaller), apply the filter, and return only matching items. This means you might request 50 items, have DynamoDB read 1,000 items from disk before hitting the 1 MB limit, apply your filter, and return only 10 matching items. Your next request would then read the next batch, and so on.

Here's a more advanced example that includes filtering and handles the count correctly:

```python
def get_purchases_over_amount(user_id, min_amount):
    """Fetch purchases above a certain amount, with pagination."""
    from boto3.dynamodb.conditions import Attr
    
    purchases = []
    exclusive_start_key = None
    
    while True:
        query_params = {
            'KeyConditionExpression': Key('userId').eq(user_id),
            'FilterExpression': Attr('amount').gte(min_amount),
            'Limit': 100
        }
        
        if exclusive_start_key:
            query_params['ExclusiveStartKey'] = exclusive_start_key
        
        response = table.query(**query_params)
        purchases.extend(response['Items'])
        
        # Check the response metadata
        print(f"Items returned: {response['Count']}")
        print(f"Items examined: {response['ScannedCount']}")
        
        if 'LastEvaluatedKey' not in response:
            break
        
        exclusive_start_key = response['LastEvaluatedKey']
    
    return purchases
```

The Count field shows how many items matched after filtering, while ScannedCount shows how many items DynamoDB examined before filtering. The difference tells you how much of your 1 MB read budget was consumed by items that didn't match your filter.

### Implementing Pagination in Node.js

Here's the equivalent pattern using the AWS SDK for JavaScript:

```javascript
const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

async function getAllPurchases(userId) {
  const purchases = [];
  let exclusiveStartKey = null;
  
  while (true) {
    const params = {
      TableName: 'UserPurchases',
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: {
        ':uid': userId
      },
      Limit: 50
    };
    
    if (exclusiveStartKey) {
      params.ExclusiveStartKey = exclusiveStartKey;
    }
    
    try {
      const response = await dynamoDb.query(params).promise();
      purchases.push(...response.Items);
      
      if (!response.LastEvaluatedKey) {
        break;
      }
      
      exclusiveStartKey = response.LastEvaluatedKey;
    } catch (error) {
      console.error('Query failed:', error);
      throw error;
    }
  }
  
  return purchases;
}
```

The DocumentClient in JavaScript abstracts away the type descriptors (S, N, etc.), making the code cleaner. The logic is identical to the Python version: loop, check for LastEvaluatedKey, update ExclusiveStartKey, repeat.

For async/await readability, you might extract pagination into a generator function:

```javascript
async function* paginateQuery(params) {
  let exclusiveStartKey = null;
  
  while (true) {
    const queryParams = { ...params };
    if (exclusiveStartKey) {
      queryParams.ExclusiveStartKey = exclusiveStartKey;
    }
    
    const response = await dynamoDb.query(queryParams).promise();
    
    for (const item of response.Items) {
      yield item;
    }
    
    if (!response.LastEvaluatedKey) {
      break;
    }
    
    exclusiveStartKey = response.LastEvaluatedKey;
  }
}

// Usage
for await (const purchase of paginateQuery({ TableName: 'UserPurchases', /* ... */ })) {
  console.log(purchase);
}
```

This approach is elegant for consuming all results, though it's less practical if you need to expose pagination to external API clients (which we'll cover next).

### Exposing Pagination to API Clients

When you build a REST or GraphQL API on top of DynamoDB, you can't simply hand LastEvaluatedKey to your clients—it's in DynamoDB's internal format and contains binary data. Instead, you encode it as a pagination token that you can safely transmit and decode.

Base64 encoding is the standard approach. Here's a Python example:

```python
import json
import base64

def encode_pagination_token(last_evaluated_key):
    """Convert LastEvaluatedKey to a base64 pagination token."""
    if not last_evaluated_key:
        return None
    
    # Serialize the key to JSON
    key_json = json.dumps(last_evaluated_key, default=str)
    # Encode as base64
    token = base64.b64encode(key_json.encode()).decode()
    return token

def decode_pagination_token(token):
    """Convert a base64 token back to LastEvaluatedKey."""
    if not token:
        return None
    
    # Decode from base64
    key_json = base64.b64decode(token.encode()).decode()
    # Deserialize from JSON
    return json.loads(key_json)

def query_purchases_paginated(user_id, pagination_token=None):
    """Query with pagination token support."""
    query_params = {
        'KeyConditionExpression': Key('userId').eq(user_id),
        'Limit': 20
    }
    
    # Decode the token if provided
    if pagination_token:
        query_params['ExclusiveStartKey'] = decode_pagination_token(pagination_token)
    
    response = table.query(**query_params)
    
    # Encode the next token
    next_token = encode_pagination_token(response.get('LastEvaluatedKey'))
    
    return {
        'items': response['Items'],
        'nextToken': next_token
    }
```

In a Flask API, you'd expose this like so:

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/users/<user_id>/purchases')
def list_purchases(user_id):
    pagination_token = request.args.get('nextToken')
    result = query_purchases_paginated(user_id, pagination_token)
    
    return jsonify({
        'purchases': result['items'],
        'nextToken': result['nextToken']
    })
```

Clients would consume this by making requests like:

```
GET /users/user-123/purchases
GET /users/user-123/purchases?nextToken=eyJ1c2VySWQiOiAidXNlci00NTYiLCAidGltZXN0YW1wIjogMTY3MjUzMTIwMH0=
```

The JavaScript equivalent looks very similar:

```javascript
function encodePaginationToken(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
}

function decodePaginationToken(token) {
  if (!token) return null;
  return JSON.parse(Buffer.from(token, 'base64').toString());
}

async function queryPurchasesPaginated(userId, paginationToken) {
  const params = {
    TableName: 'UserPurchases',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
    Limit: 20
  };
  
  if (paginationToken) {
    params.ExclusiveStartKey = decodePaginationToken(paginationToken);
  }
  
  const response = await dynamoDb.query(params).promise();
  
  return {
    items: response.Items,
    nextToken: encodePaginationToken(response.LastEvaluatedKey)
  };
}
```

### Handling Edge Cases and Best Practices

**Empty results and filters**: If you apply a FilterExpression and no items match, you'll get an empty Items array and potentially no LastEvaluatedKey (if DynamoDB didn't read the full 1 MB). Your pagination loop must account for this—don't assume that an empty result means you've reached the end. You should continue paginating until LastEvaluatedKey is absent.

**The Limit parameter and filtering interaction**: Setting a Limit doesn't mean you'll get that many results after filtering. If Limit is 100 and your filter matches only 10 of those 100 items, you'll get 10 results. On the next call, DynamoDB resumes from item 101, not item 11. This is often counterintuitive but correct—Limit controls reads, not results.

**Scan vs Query**: Query is faster and cheaper than Scan. Scan reads every item in a table (or index) sequentially, while Query uses the key structure to read only relevant items. Pagination applies to both, but if you're tempted to scan for what you could query, pagination becomes a symptom of a larger design issue.

**Consistency and pagination**: A Query or Scan with ConsistentRead set to true reads from the primary replica, while the default (eventually consistent) reads from any replica. Pagination works the same way, but be aware that if you're paginating through eventual consistency, items might be added or removed between requests, potentially causing you to miss items or see duplicates.

**Timeouts and resumability**: If a request times out during pagination, you can resume from the LastEvaluatedKey from your last successful response. This is valuable for long-running jobs that fetch large datasets. Store the token in your job state so you can pick up where you left off.

**Cost considerations**: Each pagination request is a separate DynamoDB API call and incurs read capacity units. If you're fetching all items with a Scan, you'll use one RCU per 4 KB read (for eventually consistent). If you're paginating to display 20 results at a time, each request costs the same as one 4 KB read, regardless of whether Limit is 20 or 100. Plan your Limit based on what your application actually needs, not what DynamoDB allows.

### Working with Global Secondary Indexes

Pagination works identically on GSIs, but the LastEvaluatedKey format changes. When querying a GSI, DynamoDB must track not only the GSI key (to know where you are in the GSI) but also the base table's primary key (in case it needs to fetch additional attributes from the base table or resume efficiently).

This is transparent to you—just pass the LastEvaluatedKey back as ExclusiveStartKey, and DynamoDB handles the complexity. However, it's worth knowing that a GSI's LastEvaluatedKey will be larger than a base table's because it includes both key sets.

### The Count and ScannedCount Fields

Understanding the difference between these is crucial for debugging pagination behavior:

- **ScannedCount**: The number of items examined *before* applying FilterExpression. This reflects how much of your 1 MB budget was consumed.
- **Count**: The number of items returned *after* applying FilterExpression. This is the actual result set size.

If you're filtering heavily and seeing ScannedCount far exceed Count, you're wasting read capacity. That's a signal to reconsider your data model or filtering approach—perhaps adding a GSI with different key attributes, or pre-computing aggregate data.

### Pagination Tokens and Security

When encoding LastEvaluatedKey as a pagination token, you're giving clients a value they could theoretically modify to jump to arbitrary positions in your table. Base64 encoding provides no security, only encoding. If this is a concern, you could:

Sign the token with an HMAC so you can verify clients haven't tampered with it.
Encrypt the token using a key you control, preventing clients from even reading it.
Combine both approaches for defense in depth.

For most applications, this level of security isn't necessary—pagination tokens are typically short-lived (minutes, not hours) and specific to a user's session. But for sensitive data or public APIs, consider it.

### Conclusion

DynamoDB's 1 MB response limit and pagination mechanism are designed to ensure predictable performance at scale. By understanding LastEvaluatedKey and ExclusiveStartKey, you can build pagination that's efficient, user-friendly, and production-ready.

The key takeaways: LastEvaluatedKey tells you where to resume, ExclusiveStartKey tells DynamoDB where to resume, Limit controls reads (not results after filtering), and pagination tokens should be encoded before exposing them to clients. Whether you're fetching results in loops for backend processing or exposing pagination through a REST API, these patterns remain consistent.

Pagination is one of those features that seems simple until you hit edge cases—empty results, filters, consistency concerns. But armed with these patterns and an understanding of why DynamoDB's limits exist, you'll navigate those cases confidently.
