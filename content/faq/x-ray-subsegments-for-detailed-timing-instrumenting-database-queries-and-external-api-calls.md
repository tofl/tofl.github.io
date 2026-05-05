---
title: "X-Ray Subsegments for Detailed Timing: Instrumenting Database Queries and External API Calls"
---

## X-Ray Subsegments for Detailed Timing: Instrumenting Database Queries and External API Calls

When you deploy a Lambda function or microservice to AWS, understanding where your application spends its time becomes critical. You might notice that an API request takes five seconds total, but which parts of your code are responsible? Is it the database query, the external API call, or your business logic? AWS X-Ray provides answers through the concept of subsegments—a powerful mechanism for measuring fine-grained operations within your traces.

While X-Ray's automatic instrumentation handles many common scenarios, real-world applications often involve custom database clients, internal helper functions, or business logic that the default instrumentation simply doesn't capture. That's where subsegments come in. They allow you to manually instrument your code to measure exactly what you care about, breaking down the overall execution into meaningful components that appear as distinct blocks in your trace timeline.

In this guide, we'll explore how to create custom subsegments, capture accurate timing information, and integrate metadata that makes your traces actionable. By the end, you'll understand not just how to use subsegments, but when and why to use them in your architecture.

### Understanding Subsegments and Why They Matter

A subsegment is a child segment within a larger trace that represents a specific operation or function call. Think of it like zooming into a timeline: the main segment represents your entire request, while subsegments break that down into smaller, measurable units.

Consider a typical Lambda function that processes an order. The overall segment captures the entire execution from invocation to response. But what happens inside that function? Your code might:

1. Query a custom MySQL database (not DynamoDB)
2. Call an internal validation helper function
3. Invoke an external payment API
4. Write to an S3 bucket (which X-Ray might auto-instrument)
5. Transform and return the response

X-Ray's built-in instrumentation handles the S3 call automatically. However, your custom MySQL query and the internal validation helper? Those don't show up in your trace unless you explicitly create subsegments for them. Without this visibility, you might spend hours optimizing the wrong part of your code.

Subsegments solve this problem by letting you define exactly what you want to measure. Each subsegment records its start time, end time, and any custom metadata you attach to it. In the X-Ray console, these appear as distinct colored blocks in the service graph and trace timeline, making it obvious where time is being spent.

### When Auto-Instrumentation Isn't Enough

AWS X-Ray automatically instruments calls to AWS services through the X-Ray SDK. If your Lambda function calls DynamoDB, S3, SNS, or most other AWS services, X-Ray captures that activity without any code changes on your part. The same applies to some third-party libraries—if you use the boto3 library to call AWS services, instrumentation is built in.

However, auto-instrumentation has clear boundaries. Here are the scenarios where you'll want to create custom subsegments:

**Custom database clients and queries.** If you're using a third-party database library like PyMySQL, psycopg2 (PostgreSQL), or a custom database abstraction layer, X-Ray won't automatically trace those calls. You need to wrap them in subsegments to see their timing.

**Internal helper functions that take time.** A function that validates business rules, transforms data, or performs calculations might take significant time. If you want visibility into how long that function takes, you create a subsegment around it.

**External API calls made with HTTP clients.** When you use the requests library in Python, httpx, or Go's net/http to call non-AWS services, X-Ray won't automatically trace them. You'll want subsegments for critical external calls.

**Complex business logic with multiple steps.** Sometimes you want to break down a single function into multiple measured steps. For example, if you have a function that loads configuration, processes data, and generates a report, you might create three separate subsegments to understand the contribution of each step.

**Long-running operations.** Any operation that takes more than a few milliseconds and contributes meaningfully to your overall latency is a candidate for a subsegment.

The key principle is this: if you can't see it in your X-Ray trace, you can't optimize it. Custom subsegments give you that visibility.

### Creating Subsegments: The Practical Approach

To work with subsegments, you'll use the X-Ray SDK for your language of choice. The examples below focus on Python (using the aws-xray-sdk library) and Node.js (using aws-xray-sdk-core), as these are the most common choices for serverless workloads.

#### Setting Up the X-Ray SDK

First, ensure you have the appropriate SDK installed and imported. For Python:

```python
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.core import patch_all

# Patch AWS SDK and common libraries
patch_all()
```

For Node.js:

```javascript
const AWSXRay = require('aws-xray-sdk-core');
```

Once imported, the `xray_recorder` (Python) or `AWSXRay` (Node.js) object becomes your interface for creating and managing subsegments.

#### The Basic Pattern: Begin and End

The fundamental pattern for creating a subsegment involves starting it, executing your operation, and then closing it. In Python:

```python
subsegment = xray_recorder.begin_subsegment('operation-name')
try:
    # Your operation here
    result = some_operation()
finally:
    xray_recorder.end_subsegment()
```

In Node.js:

```javascript
const subsegment = AWSXRay.getSegment().addNewSubsegment('operation-name');
try {
    // Your operation here
    const result = someOperation();
} finally {
    subsegment.close();
}
```

The `finally` block is crucial—it ensures the subsegment is properly closed even if an error occurs. This is important for accurate timing and trace integrity.

#### A Real Example: Timing a Custom Database Query

Let's say you have a Lambda function that queries a PostgreSQL database using psycopg2. The database isn't an AWS service, so X-Ray won't automatically trace it. Here's how you'd create a subsegment to measure the query time:

```python
import psycopg2
from aws_xray_sdk.core import xray_recorder

def get_user_by_id(user_id):
    """Fetch a user from PostgreSQL and measure the query time."""
    subsegment = xray_recorder.begin_subsegment('postgresql-query')
    try:
        conn = psycopg2.connect(
            host="db.example.com",
            database="users",
            user="app_user",
            password="secure_password"
        )
        cursor = conn.cursor()
        
        # Execute the query
        cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        user = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        return user
    except Exception as e:
        # Record the exception in the subsegment
        subsegment.put_exception(e)
        raise
    finally:
        xray_recorder.end_subsegment()
```

When this code runs, X-Ray creates a subsegment named "postgresql-query" that captures the exact time from connection through query execution and result retrieval. In the X-Ray console, this appears as a distinct block in your trace timeline.

#### Adding Metadata to Subsegments

Timing alone is useful, but metadata makes traces truly actionable. You can attach arbitrary key-value data to a subsegment, which shows up in the X-Ray console and helps you understand what was actually happening.

```python
subsegment = xray_recorder.begin_subsegment('database-query')
try:
    # Add metadata about what you're querying
    subsegment.put_metadata('query', 'SELECT * FROM users WHERE id = %s')
    subsegment.put_metadata('parameters', [user_id])
    subsegment.put_metadata('database', 'users_db')
    
    # Execute query
    result = execute_query(sql, params)
    
    # Add metadata about the result
    subsegment.put_metadata('row_count', len(result))
    
    return result
except Exception as e:
    subsegment.put_exception(e)
    raise
finally:
    xray_recorder.end_subsegment()
```

In the X-Ray console, when you click on this subsegment, you'll see all the metadata you attached. This context is invaluable for understanding what your code was actually doing when the trace was captured.

#### Annotations: Searchable Metadata

While metadata is great for inspection, annotations are even better when you need to search or filter traces. Annotations are indexed key-value pairs that allow you to build filter expressions in the X-Ray console.

```python
subsegment = xray_recorder.begin_subsegment('payment-processing')
try:
    # Add annotations for later searching
    subsegment.put_annotation('order_id', order_id)
    subsegment.put_annotation('customer_tier', customer_tier)
    subsegment.put_annotation('payment_method', 'credit_card')
    
    result = process_payment(order_id, amount)
    return result
except Exception as e:
    subsegment.put_exception(e)
    raise
finally:
    xray_recorder.end_subsegment()
```

Now you can filter traces by customer tier, order ID, or payment method directly in the X-Ray console. This becomes powerful when you're investigating issues that affect specific customer segments.

### Measuring Complex Operations with Nested Subsegments

Subsegments can be nested—you can create a subsegment within a subsegment. This is useful when you want to break down a complex operation into multiple measured steps.

Consider a function that processes an order with several distinct phases:

```python
def process_order(order_data):
    """Process an order with multiple measured steps."""
    
    # Main operation subsegment
    main_subsegment = xray_recorder.begin_subsegment('order-processing')
    try:
        # Step 1: Validate the order
        validation_subsegment = xray_recorder.begin_subsegment('validation')
        try:
            validate_order(order_data)
        finally:
            xray_recorder.end_subsegment()
        
        # Step 2: Query inventory
        inventory_subsegment = xray_recorder.begin_subsegment('inventory-check')
        try:
            inventory_subsegment.put_annotation('sku', order_data['sku'])
            inventory = check_inventory(order_data['sku'])
            inventory_subsegment.put_metadata('available_quantity', inventory)
        finally:
            xray_recorder.end_subsegment()
        
        # Step 3: Process payment
        payment_subsegment = xray_recorder.begin_subsegment('payment-processing')
        try:
            payment_subsegment.put_annotation('amount', order_data['total'])
            process_payment(order_data['total'])
        finally:
            xray_recorder.end_subsegment()
        
        return {'status': 'success', 'order_id': order_data['id']}
    except Exception as e:
        main_subsegment.put_exception(e)
        raise
    finally:
        xray_recorder.end_subsegment()
```

In the X-Ray console trace timeline, you'll see the main "order-processing" subsegment broken down into three child subsegments: "validation," "inventory-check," and "payment-processing." This gives you a clear visual hierarchy of where time is being spent within your operation.

### Practical Example: Timing External API Calls

Let's look at another real-world scenario—calling an external API that X-Ray doesn't auto-instrument. Here's how you'd measure an API call to a third-party service:

```python
import requests
from aws_xray_sdk.core import xray_recorder

def fetch_fraud_score(user_id, transaction_amount):
    """Call an external fraud detection API and measure the response time."""
    subsegment = xray_recorder.begin_subsegment('fraud-detection-api')
    try:
        subsegment.put_annotation('user_id', user_id)
        subsegment.put_annotation('amount', transaction_amount)
        
        # Call the external API
        response = requests.post(
            'https://api.fraud-detector.com/check',
            json={'user_id': user_id, 'amount': transaction_amount},
            timeout=5
        )
        
        response.raise_for_status()
        data = response.json()
        
        # Record the result
        subsegment.put_metadata('fraud_score', data['score'])
        subsegment.put_metadata('risk_level', data['risk_level'])
        
        return data
    except requests.RequestException as e:
        subsegment.put_exception(e)
        raise
    finally:
        xray_recorder.end_subsegment()
```

This subsegment captures the exact time taken by the external API call, including network latency. If you notice that your order processing is slow, you can immediately see whether the bottleneck is the fraud detection API (high external latency), your business logic (high computation time), or something else entirely.

### Context Managers for Cleaner Code

In Python, you can use context managers to simplify subsegment creation and ensure proper cleanup. The X-Ray SDK provides a context manager interface:

```python
from aws_xray_sdk.core import xray_recorder

def process_user_data(user_id):
    """Process user data with a cleaner subsegment pattern."""
    with xray_recorder.in_subsegment('user-processing') as subsegment:
        subsegment.put_annotation('user_id', user_id)
        
        # Load user from database
        user = load_user(user_id)
        
        # Validate user
        with xray_recorder.in_subsegment('user-validation') as val_subsegment:
            validate_user(user)
        
        # Process preferences
        with xray_recorder.in_subsegment('preference-processing') as pref_subsegment:
            process_preferences(user)
        
        return user
```

The context manager approach is often preferred because it guarantees that the subsegment is closed even if an exception occurs, and it's more readable. The `with` statement automatically handles the begin and end operations.

### Viewing Subsegments in the X-Ray Console

Once you've instrumented your code with subsegments, the AWS X-Ray console visualizes them in several ways.

In the **Service Map**, you'll see nodes for each distinct service or operation your application touches. Subsegments typically appear as part of the main Lambda node, but they contribute to the visual representation of your application's architecture.

In the **Trace Timeline**, subsegments appear as horizontal blocks, color-coded by type (AWS service calls, custom subsegments, errors, etc.). The width of each block represents its duration. When you click on a subsegment, you see all its metadata and annotations. This visual representation makes it immediately obvious which parts of your execution are taking the most time.

The **Trace List** shows aggregated statistics about your traces. You can filter traces by annotations (e.g., "show me all traces where payment_method equals 'credit_card'"), making it easy to investigate specific scenarios.

### Handling Errors in Subsegments

When an exception occurs within a subsegment, you should record it using `put_exception()`. This adds the exception information to your trace without preventing it from propagating.

```python
def risky_operation():
    subsegment = xray_recorder.begin_subsegment('risky-operation')
    try:
        # Perform operation that might fail
        result = unstable_external_call()
        return result
    except Exception as e:
        subsegment.put_exception(e)
        # Mark as an error in X-Ray
        subsegment.put_error(True)
        raise  # Re-raise so the caller handles it
    finally:
        xray_recorder.end_subsegment()
```

The `put_error(True)` call marks the subsegment as having encountered an error, which shows up distinctly in the X-Ray console. The exception details are included in the trace metadata.

### Performance Considerations

While subsegments are powerful, it's worth noting that creating subsegments has a small CPU and memory cost. The X-Ray SDK must track timing, serialize metadata, and manage the subsegment hierarchy.

For high-throughput applications, avoid creating thousands of subsegments per second. Instead, be strategic: create subsegments for operations that are slow (anything taking more than a few milliseconds), for operations that vary significantly in execution time, or for operations you're actively investigating and optimizing.

In most cases, the performance overhead is negligible—typically sub-millisecond per subsegment. The value of the visibility far outweighs the cost.

### Best Practices for Subsegment Naming

How you name your subsegments matters. Good names are descriptive, consistent, and useful for filtering and searching.

Rather than vague names like "operation" or "call," use names that describe what's happening: "postgresql-user-lookup," "fraud-api-check," "order-validation." If you're creating subsegments dynamically based on operation type, include that information in the name.

Avoid using user-specific or high-cardinality data in subsegment names. For example, don't name a subsegment "process-order-12345"—instead, name it "process-order" and include the order ID as an annotation. This prevents creating too many distinct subsegment types, which can make the X-Ray console harder to navigate.

### Integrating Subsegments with Business Metrics

Subsegments measure time, but combining that data with your business logic creates powerful insights. For instance:

```python
def calculate_recommendation_score(user_id, product_list):
    """Calculate recommendations and track both timing and accuracy."""
    subsegment = xray_recorder.begin_subsegment('recommendation-engine')
    try:
        # Include the input size in metadata
        subsegment.put_metadata('product_count', len(product_list))
        
        # Call the recommendation engine
        recommendations = call_recommendation_service(user_id, product_list)
        
        # Track business metrics
        subsegment.put_metadata('recommendation_count', len(recommendations))
        subsegment.put_annotation('engine_version', 'v2.1')
        
        return recommendations
    finally:
        xray_recorder.end_subsegment()
```

By capturing both timing and business metrics, you can correlate performance issues with business outcomes. If recommendation accuracy drops when the engine is slow, that's actionable information.

### Conclusion

Subsegments transform X-Ray from a "what happened" tool into a "where did my time go" tool. By instrumenting your custom database queries, external API calls, and complex business logic with subsegments, you gain visibility into the actual performance characteristics of your application.

The pattern is straightforward: identify the operations that matter to your understanding of performance, wrap them in subsegments with meaningful names, attach relevant metadata and annotations, and let X-Ray visualize the results. Over time, you'll develop an intuition for which operations deserve subsegments in your specific architecture.

Start with the slowest or most uncertain operations in your application, measure them, and optimize based on actual data rather than guesses. That's how subsegments help you build faster, more efficient applications on AWS.
