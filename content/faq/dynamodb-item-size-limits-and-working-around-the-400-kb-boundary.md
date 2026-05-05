---
title: "DynamoDB Item Size Limits and Working Around the 400 KB Boundary"
---

## DynamoDB Item Size Limits and Working Around the 400 KB Boundary

Every developer working with DynamoDB eventually hits a hard truth: you can't store unlimited data in a single item. AWS enforces a strict 400 KB per-item size limit, and understanding this boundary is essential for designing schemas that scale without surprises. This isn't an edge case or a soft recommendation—it's a fundamental constraint that affects your architecture decisions, cost calculations, and application reliability.

The 400 KB limit sounds straightforward on the surface, but the devil is in the details. What exactly counts toward that limit? How does it interact with your capacity costs? And what practical strategies can you use when your data inevitably exceeds it? Let's explore these questions with the depth and nuance they deserve.

### Understanding What Counts in the 400 KB Limit

When AWS calculates an item's size, it doesn't just count the values you store. The calculation includes attribute names, attribute values, and the JSON overhead required to structure the data in DynamoDB's internal format. This is a critical distinction that catches many developers off guard.

Think of it this way: DynamoDB stores everything as JSON-like structures internally. When you write an item with attributes like `UserId`, `Timestamp`, and `ProfileData`, the size calculation includes the characters in those attribute names themselves, not just the data they contain. A 10-character attribute name contributes to your 400 KB budget just as much as a 10-character value does.

For values, the size calculation varies by data type. String and binary values are measured in bytes after encoding. Numbers are stored in a variable-length format that depends on their magnitude—a small number like 5 takes fewer bytes than a large number like 999999999999. Boolean values (true/false) take a fixed amount of space. Even null values, empty strings, and empty binary sets occupy bytes in the calculation.

The JSON structure itself also contributes overhead. Each attribute requires metadata describing its type—whether it's a string (S), number (N), binary (B), set, or document. List and map structures add additional nesting overhead. A deeply nested document with many small attributes can consume more space for structural metadata than for actual data.

Here's a practical example. Consider this item:

```json
{
  "UserId": "user-12345",
  "Timestamp": 1699564800,
  "ProfileData": {
    "FirstName": "Alice",
    "LastName": "Smith",
    "Bio": "Software engineer interested in cloud computing"
  }
}
```

The size calculation includes:
- The string "UserId" (6 bytes) plus the value "user-12345" (10 bytes)
- The string "Timestamp" (9 bytes) plus the number representation
- The string "ProfileData" (11 bytes) plus metadata for the nested map
- Each nested attribute name and value

You're looking at around 150 bytes total for this item, well under the limit, but the principle holds: every character in every attribute name and value counts.

### How Size Relates to Write Capacity Costs

The 400 KB limit isn't just a storage boundary—it directly affects your financial costs. DynamoDB charges for writes based on item size, rounded up to the nearest 1 KB. An item of any size up to 1 KB costs 1 write capacity unit (WCU). An item between 1 KB and 2 KB costs 2 WCUs. This scaling continues linearly all the way up to 400 KB.

This means a 400 KB item costs exactly 400 WCUs for a single write operation. That's not a typo or an exaggeration. If you're writing large items frequently, your write capacity provisioning must account for this significant cost. A single application writing ten 400 KB items per second would require 4,000 WCUs just for that workload—a substantial expense.

This relationship is why the 400 KB limit matters economically, not just architecturally. You might technically be able to design a schema that pushes items toward this boundary, but the cost implications often make it impractical. A solution that compresses data, splits items intelligently, or offloads bulk storage to S3 can reduce your WCU consumption dramatically.

For read operations, the cost relationship is similar but slightly different. Eventually consistent reads cost 0.5 RCUs per 4 KB, while strongly consistent reads cost 1 RCU per 4 KB. A 400 KB read with strong consistency would cost 100 RCUs—expensive, but less immediately catastrophic than the write cost. Still, these numbers reinforce why staying well under the 400 KB boundary is prudent.

### Detecting Items Approaching the Limit

Before you hit the hard wall of the 400 KB limit, you need visibility into how close your items are creeping toward it. AWS provides a few mechanisms for this detection.

When you write an item to DynamoDB using the SDK, the response includes metadata about the operation. You can access the `ConsumedWriteCapacityUnits` from the response, which tells you how many WCUs were consumed. Since the WCU cost directly correlates to item size (rounded up), you can reverse-engineer the item size. A response showing 250 WCUs consumed means the item was between 249 KB and 250 KB.

For a more direct approach, calculate the item size in your application code before writing. Different SDKs provide utilities for this. In the AWS SDK for Python (Boto3), you can use the `serialize` functions from the `boto3.dynamodb.types` module to understand how your data will be encoded, then calculate the resulting byte size. Here's a practical pattern:

```python
import json
from boto3.dynamodb.types import TypeSerializer

def estimate_item_size(item):
    """Estimate DynamoDB item size in bytes."""
    serializer = TypeSerializer()
    serialized = {k: serializer.serialize(v) for k, v in item.items()}
    # Convert to JSON and measure byte length
    json_str = json.dumps(serialized, separators=(',', ':'))
    return len(json_str.encode('utf-8'))

# Example usage
item = {
    'UserId': 'user-12345',
    'Timestamp': 1699564800,
    'LargeData': 'x' * 300000  # 300 KB of data
}

size = estimate_item_size(item)
print(f"Item size: {size} bytes ({size / 1024:.1f} KB)")
```

This approach gives you precise size information before you write to DynamoDB, allowing you to implement guards or alternative strategies when items approach dangerous sizes.

You can also enable DynamoDB Streams and process the stream records with Lambda functions that monitor item sizes. This is more operationally complex but provides real-time detection across your entire application. For critical production systems, this approach catches unexpected data growth immediately.

### The S3 Pointer Pattern: Offloading Large Data

The most common and effective strategy for handling data that exceeds 400 KB is the S3 pointer pattern. Instead of storing the entire payload in DynamoDB, you store the bulk of the data in Amazon S3 and keep only a pointer (typically the S3 object key or ARN) in DynamoDB.

Here's how it works in practice. Imagine you're building a document management system where users upload large files that you need to track. Rather than storing the entire file content in a DynamoDB item, you store it in S3 and keep a reference:

```python
import boto3
import json
from datetime import datetime

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
documents_table = dynamodb.Table('Documents')

def store_large_document(user_id, document_content, metadata):
    """Store a large document in S3 with metadata in DynamoDB."""
    
    # Generate a unique key for S3
    timestamp = datetime.utcnow().isoformat()
    s3_key = f"documents/{user_id}/{timestamp}.bin"
    
    # Upload the large content to S3
    s3_client.put_object(
        Bucket='my-documents-bucket',
        Key=s3_key,
        Body=document_content,
        ServerSideEncryption='AES256'
    )
    
    # Store metadata and pointer in DynamoDB
    item = {
        'UserId': user_id,
        'DocumentId': timestamp,
        'S3Key': s3_key,
        'S3Bucket': 'my-documents-bucket',
        'CreatedAt': timestamp,
        'Metadata': metadata,
        'ContentLength': len(document_content),
        'Status': 'AVAILABLE'
    }
    
    documents_table.put_item(Item=item)
    return s3_key

def retrieve_document(user_id, document_id):
    """Retrieve document metadata from DynamoDB and content from S3."""
    
    # Get metadata from DynamoDB
    response = documents_table.get_item(
        Key={'UserId': user_id, 'DocumentId': document_id}
    )
    
    if 'Item' not in response:
        return None
    
    item = response['Item']
    
    # Fetch content from S3
    s3_response = s3_client.get_object(
        Bucket=item['S3Bucket'],
        Key=item['S3Key']
    )
    
    content = s3_response['Body'].read()
    
    return {
        'metadata': item,
        'content': content
    }
```

This pattern offers several advantages. First, it eliminates the 400 KB constraint entirely—S3 can handle objects up to 5 TB. Second, it often reduces costs. Storing 100 MB in S3 costs about 2 cents per month, while writing that same data to DynamoDB would cost thousands of WCUs and much more in capacity charges. Third, it separates concerns cleanly: DynamoDB handles metadata and queries, while S3 handles bulk storage.

The tradeoff is latency. Retrieving a document now requires two API calls instead of one. For most use cases, this is acceptable—the performance difference between a DynamoDB get and an S3 get is typically measured in tens of milliseconds either way. For ultra-latency-sensitive applications, you might choose differently, but most systems find this trade worthwhile.

One important consideration: ensure your data in S3 is properly secured and your DynamoDB items maintain referential integrity. If you delete an S3 object, your DynamoDB pointer becomes a broken link. Implementing lifecycle policies, versioning, or soft-delete patterns helps maintain consistency.

### Splitting Items Across Sort Keys

Another strategy for handling large datasets is to split logically related data across multiple items using different sort keys. This is particularly effective when you have a primary record plus associated details that can be retrieved separately.

For example, suppose you're storing user profiles with extensive preference data. Rather than putting everything in a single item, you could use a schema like this:

```
PK: UserId
SK: PROFILE#MAIN
  -> Contains: name, email, account status, created date
  
PK: UserId  
SK: PROFILE#PREFERENCES#general
  -> Contains: theme, language, timezone
  
PK: UserId
SK: PROFILE#PREFERENCES#notifications
  -> Contains: email settings, push settings, frequency rules
  
PK: UserId
SK: PROFILE#SETTINGS#privacy
  -> Contains: privacy visibility rules, blocking settings
```

This design allows each item to stay well under 400 KB while keeping logically related data together under the same partition key. You can fetch just the main profile, fetch all preferences with a `begins_with` query, or fetch a specific preference category.

Here's how you might implement this:

```python
def update_user_preferences(user_id, preference_type, preferences):
    """Update a specific preference category."""
    
    table.update_item(
        Key={
            'UserId': user_id,
            'SK': f'PROFILE#PREFERENCES#{preference_type}'
        },
        UpdateExpression='SET #p = :prefs, UpdatedAt = :now',
        ExpressionAttributeNames={'#p': 'Preferences'},
        ExpressionAttributeValues={
            ':prefs': preferences,
            ':now': int(datetime.utcnow().timestamp())
        }
    )

def get_all_user_preferences(user_id):
    """Fetch all preference items for a user."""
    
    response = table.query(
        KeyConditionExpression=Key('UserId').eq(user_id) & Key('SK').begins_with('PROFILE#PREFERENCES'),
        ProjectionExpression='SK, Preferences'
    )
    
    # Reconstruct preferences from multiple items
    all_preferences = {}
    for item in response['Items']:
        category = item['SK'].split('#')[-1]
        all_preferences[category] = item.get('Preferences', {})
    
    return all_preferences
```

This approach works well when your data naturally decomposes into logical units. The downside is increased query complexity—fetching a complete profile now requires multiple queries instead of one. You might use batch operations or transactions to retrieve related items efficiently.

### Compression: Squeezing More Data Into Less Space

When your data is inherently compressible—JSON documents, text, logs, or structured data—compression can significantly reduce item size. Gzip compression typically achieves 70-90% reduction for text-heavy payloads, which could mean storing data that would have been 350 KB in just 50 KB.

The technique is straightforward: compress your data before writing, decompress when reading. Here's a practical implementation:

```python
import gzip
import base64
import json

def compress_and_store_document(user_id, document_data):
    """Compress large document and store in DynamoDB."""
    
    # Serialize to JSON
    json_str = json.dumps(document_data, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    
    # Compress with gzip
    compressed = gzip.compress(json_bytes, compresslevel=9)
    
    # Encode to base64 for safe storage
    encoded = base64.b64encode(compressed).decode('utf-8')
    
    # Store with metadata
    item = {
        'UserId': user_id,
        'DocumentId': str(datetime.utcnow().timestamp()),
        'CompressedData': encoded,
        'Compressed': True,
        'OriginalSize': len(json_bytes),
        'CompressedSize': len(compressed),
        'StoredAt': datetime.utcnow().isoformat()
    }
    
    print(f"Compression ratio: {len(compressed) / len(json_bytes):.1%}")
    table.put_item(Item=item)

def retrieve_and_decompress_document(user_id, document_id):
    """Retrieve and decompress document from DynamoDB."""
    
    response = table.get_item(
        Key={'UserId': user_id, 'DocumentId': document_id}
    )
    
    if 'Item' not in response:
        return None
    
    item = response['Item']
    
    if not item.get('Compressed'):
        return json.loads(item['CompressedData'])
    
    # Decode from base64
    compressed = base64.b64decode(item['CompressedData'].encode('utf-8'))
    
    # Decompress
    decompressed = gzip.decompress(compressed)
    
    # Parse JSON
    return json.loads(decompressed.decode('utf-8'))
```

Compression adds a small CPU cost to serialization and deserialization, but modern systems handle gzip compression so efficiently that this overhead is typically negligible—often under 10 milliseconds even for large payloads. The WCU savings often far outweigh this cost.

There's a subtle but important point here: compression is particularly valuable for large items approaching the 400 KB limit because it directly reduces your write capacity costs. An item that would have cost 400 WCUs might cost only 50 WCUs after compression, a 8x cost reduction.

However, compression works best for text and structured data. Binary data that's already compressed (images, videos, archives) won't compress further and may actually expand slightly. JSON with lots of repeated keys might compress better than sparse data. Measure the compression ratio for your actual data before committing to this strategy.

### Combining Strategies: A Practical Example

In real-world systems, you often combine multiple strategies. Consider a content management system where users upload articles with metadata:

Articles have substantial text content (often 50-300 KB), metadata like title and author (small), and embedded media references (moderate). The optimal design might look like this:

Store the article metadata and a compressed summary in DynamoDB, the full article text in S3, and media references as pointers:

```python
def publish_article(user_id, article_data):
    """Publish an article using a hybrid storage strategy."""
    
    # Extract components
    title = article_data['title']
    author = article_data['author']
    content = article_data['content']
    media = article_data.get('media', [])
    
    # Upload large content to S3
    article_id = str(datetime.utcnow().timestamp())
    s3_key = f"articles/{user_id}/{article_id}.txt"
    
    s3_client.put_object(
        Bucket='article-bucket',
        Key=s3_key,
        Body=content.encode('utf-8')
    )
    
    # Create a compressed summary for quick preview
    summary = content[:500]  # First 500 chars
    summary_compressed = gzip.compress(
        json.dumps({'summary': summary}).encode('utf-8')
    )
    summary_encoded = base64.b64encode(summary_compressed).decode('utf-8')
    
    # Store metadata in DynamoDB
    item = {
        'UserId': user_id,
        'ArticleId': article_id,
        'Title': title,
        'Author': author,
        'PublishedAt': datetime.utcnow().isoformat(),
        'ContentS3Key': s3_key,
        'ContentLength': len(content),
        'CompressedSummary': summary_encoded,
        'Media': media,  # References to S3 keys or URLs
        'Status': 'PUBLISHED'
    }
    
    articles_table.put_item(Item=item)
    return article_id

def get_article_preview(user_id, article_id):
    """Get article metadata and summary without fetching full content."""
    
    response = articles_table.get_item(
        Key={'UserId': user_id, 'ArticleId': article_id}
    )
    
    item = response['Item']
    
    # Decompress summary if present
    summary = None
    if 'CompressedSummary' in item:
        compressed = base64.b64decode(item['CompressedSummary'].encode('utf-8'))
        decompressed = gzip.decompress(compressed)
        summary = json.loads(decompressed)['summary']
    
    return {
        'title': item['Title'],
        'author': item['Author'],
        'published': item['PublishedAt'],
        'summary': summary,
        'media': item.get('Media', [])
    }

def get_full_article(user_id, article_id):
    """Get complete article with content."""
    
    # Get metadata
    item = articles_table.get_item(
        Key={'UserId': user_id, 'ArticleId': article_id}
    )['Item']
    
    # Fetch content from S3
    content = s3_client.get_object(
        Bucket='article-bucket',
        Key=item['ContentS3Key']
    )['Body'].read().decode('utf-8')
    
    return {
        'title': item['Title'],
        'author': item['Author'],
        'content': content,
        'published': item['PublishedAt'],
        'media': item.get('Media', [])
    }
```

This design provides excellent flexibility. Quick previews hit DynamoDB for lightweight metadata. Full content retrieval fetches from S3. Media handling can scale independently. Each component stays within reasonable size limits while the system handles multi-megabyte articles effortlessly.

### Schema Design Principles to Prevent Size Issues

The best approach to the 400 KB limit is designing schemas that naturally avoid pushing against it. A few principles help:

**Normalize strategically.** Store related data in separate items when the relationship is one-to-many or the details are frequently accessed independently. Keep only the essential details in the parent item.

**Use sort key hierarchies.** Sort keys allow you to model relationships efficiently. An item with `PK=UserId` and `SK=ORDER#12345` differs from `SK=ORDER#12345#ITEM#1`. This granularity helps you distribute data across multiple items naturally.

**Limit nested document depth.** Deep nesting adds JSON structure overhead. Keep documents flatter when possible. A map containing another map containing another map has metadata overhead at each level.

**Choose attribute names wisely.** Short attribute names consume less space. While cryptic names like `u` instead of `UserId` save bytes, they harm readability. Aim for meaningful but reasonably concise names. Consider abbreviations for frequently repeated attributes in large documents.

**Separate hot and cold data.** Data you access frequently should be in a small, quick-loading item. Data accessed rarely can be split off to separate items or S3. This improves query performance and reduces WCU costs simultaneously.

### Performance and Cost Tradeoffs

Understanding the 400 KB limit requires thinking about the broader performance and cost context. A technically possible design that pushes items to 350-380 KB might work but leave you vulnerable to growth and carry high operational costs.

Here's rough guidance: items consistently under 100 KB are safe and rarely problematic. Items between 100-300 KB are fine but require monitoring and careful design. Items 300-400 KB should trigger serious consideration of splitting, compression, or S3 offloading. Items approaching 400 KB demand immediate action.

From a cost perspective, large items are expensive to write and moderately expensive to read. If you're writing 100 KB items ten times per second, you're consuming 1,000 WCUs—a significant ongoing cost. Investing effort in compression or splitting often pays for itself in reduced capacity costs within weeks.

### Conclusion

The 400 KB per-item size limit in DynamoDB isn't a limitation you need to fear—it's a design constraint that encourages better architecture. Understanding what counts toward the limit, how it affects your costs, and the practical strategies for handling larger data gives you the tools to design systems that scale efficiently.

The S3 pointer pattern is your go-to for truly large data. Item splitting across sort keys works well for related data that logically decomposes. Compression is valuable for text-heavy content. Most production systems use a combination of these approaches, each suited to different parts of their data model.

The key is measuring and monitoring. Estimate item sizes before writing them. Check WCU consumption in production. Set up alerts when items approach dangerous sizes. With visibility into your data, you can adapt your schema confidently as your application evolves. The 400 KB boundary becomes not an obstacle, but a useful waypoint that guides you toward cleaner, more cost-effective designs.
