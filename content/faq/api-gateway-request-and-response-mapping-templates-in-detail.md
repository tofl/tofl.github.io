---
title: "API Gateway Request and Response Mapping Templates in Detail"
---

## API Gateway Request and Response Mapping Templates in Detail

When you set up an API in AWS API Gateway, you're often sitting at a critical junction: the raw request from your client and the response from your backend service rarely speak the same language. A mobile app might send data in one format, your Lambda function expects something different, and your clients want the response shaped in yet another way. This is where request and response mapping templates become invaluable. By mastering mapping templates—specifically those written in Velocity Template Language (VTL)—you gain the ability to transform data in flight, decouple your frontend and backend contracts, and implement sophisticated integration patterns that would otherwise require additional code layers.

In this article, we'll explore mapping templates comprehensively, moving well beyond surface-level understanding to show you how to build real transformations, debug them effectively, and understand their interaction with different integration types. Whether you're connecting to Lambda, HTTP endpoints, or AWS services, mapping templates give you precise control over what leaves your API and what returns to your clients.

### Understanding the Mapping Template Concept

Before we dive into syntax, let's establish what mapping templates actually do. API Gateway sits as a proxy between your clients and your backend resources. By default, it passes requests and responses through with minimal transformation. However, you can intercept and reshape both the incoming request and the outgoing response using mapping templates.

Think of it this way: imagine you're a translator working in a busy office. Your job is to receive messages in English, understand what they mean, and pass them to a colleague who only understands French. Then, when that colleague responds in French, you translate back to English for the original sender. Mapping templates are your translation instructions—the rules that tell you what to transform and how.

The request mapping template transforms the client's incoming request into a format your backend service expects. The response mapping template does the reverse: it takes whatever your backend returns and transforms it into a format suitable for your API clients. This separation of concerns is powerful because it means your backend service and your API contract can evolve independently, as long as the mapping templates evolve to bridge any gaps.

### The Role of Velocity Template Language (VTL)

Velocity Template Language is a simple, powerful templating language designed by the Apache project. AWS chose VTL for API Gateway mapping templates because it strikes a good balance between expressiveness and simplicity. It's not a full programming language—you can't define complex algorithms—but it gives you enough tools to perform common data transformations elegantly.

VTL is driven by three main elements: variables (preceded by `$`), directives (like `#if`, `#foreach`, `#set`), and literals (plain text that passes through unchanged). When API Gateway processes your template, it evaluates all VTL constructs and outputs the resulting text, which becomes the request body sent to your backend (for request templates) or the response body returned to your client (for response templates).

A crucial point: mapping templates work with the *body* of requests and responses. Headers, status codes, and other metadata are handled separately through header mappings and integration response configurations. When we talk about transforming data with mapping templates, we're primarily talking about the message payload itself.

### The `$input` Object: Accessing Request Data

The `$input` object is your gateway to request data. It's automatically available in request mapping templates and provides several methods to access and parse incoming data. Understanding these methods is essential because different parsing approaches suit different scenarios.

The most commonly used method is `$input.path()`, which uses JSONPath expressions to extract specific values from the request body. JSONPath is a query language for JSON, similar in spirit to XPath for XML. For example, if a client sends this JSON body:

```json
{
  "user": {
    "id": 12345,
    "email": "alice@example.com"
  },
  "action": "login"
}
```

You could extract the user ID with `$input.path('$.user.id')`. The `$` symbol represents the root of the JSON document, and you traverse the hierarchy with dots. This method is incredibly useful when you need specific fields from a larger payload or when you want to pluck values for use in header mappings or Lambda invocation paths.

Another essential method is `$input.json()`, which parses the entire request body as JSON and returns a map-like object you can work with in VTL. For instance, `$input.json('$').user.email` would give you the email from our example above. The difference between `path()` and `json()` is subtle but important: `path()` returns a string representation of the JSONPath result, while `json()` returns a parsed object you can iterate over or manipulate further.

`$input.params()` gives you access to query string parameters and path parameters. If your API endpoint is `/users/{userId}` and a client calls `/users/42?includeDetails=true`, you could access the path parameter with `$input.params('userId')` and the query parameter with `$input.params('includeDetails')`. This is valuable when you need to incorporate incoming parameters into the transformation.

`$input.headers()` provides access to HTTP headers. Client-provided headers like `Authorization`, `Content-Type`, or custom headers can be examined and used in your template logic. For example, `$input.headers('Authorization')` would give you the bearer token if one was provided.

### The `$output` Object: Working with Responses

In response mapping templates, the `$output` object provides access to the response from your backend service. Where `$input` lets you work with what's coming in, `$output` lets you work with what's coming back.

The primary method you'll use is `$output.json()`, which parses the backend's response body as JSON. This works identically to `$input.json()` but operates on the response from your integration. If your Lambda function returns a JSON object, `$output.json('$')` gives you the entire response as a parsed object, and `$output.json('$.data.items')` would let you extract a nested array.

`$output.getStatus()` retrieves the HTTP status code returned by your backend. This is particularly useful for conditional response formatting. For example, you might want to wrap a 200 response differently than a 400 response, or include error details only when the backend returned an error code.

`$output.getStatusCode()` is an alias for `getStatus()` and does the same thing. You'll see both in AWS documentation, though they're functionally identical.

One method that trips up many developers is understanding when the backend response is actually available. In non-Proxy integrations, the response mapping template can access `$output`. However, if you're using Lambda Proxy integration, the Lambda function is responsible for returning the full HTTP response including status code and headers, and the mapping template stage is often bypassed entirely. We'll explore this distinction in detail later.

### Request Mapping Templates: Transforming Inbound Data

Let's work through realistic request mapping scenarios. Request mapping templates transform what the client sends into what your backend expects. This is where you'll spend a lot of your template work, because client-facing APIs often need to support multiple versions or formats.

Consider a scenario where your mobile app sends user data in one structure, but your legacy backend service expects a different structure. The mobile app sends:

```json
{
  "firstName": "Alice",
  "lastName": "Smith",
  "contact": {
    "email": "alice@example.com",
    "phone": "+1-555-0100"
  }
}
```

But your backend Lambda expects:

```json
{
  "first_name": "Alice",
  "last_name": "Smith",
  "email_address": "alice@example.com",
  "phone_number": "+1-555-0100"
}
```

Your request mapping template would transform this:

```
{
  "first_name": "$input.json('$.firstName')",
  "last_name": "$input.json('$.lastName')",
  "email_address": "$input.json('$.contact.email')",
  "phone_number": "$input.json('$.contact.phone')"
}
```

Notice that the template itself is JSON with VTL expressions embedded. When API Gateway processes this, it evaluates each VTL variable and substitutes the result into the JSON. The output is a properly formatted JSON object that your backend understands.

Now let's look at a more complex example involving conditional logic. Suppose you want to add a default timestamp only if the client didn't provide one:

```
#set($inputMap = $input.json('$'))
{
  "userId": "$inputMap.userId",
  "action": "$inputMap.action",
  "timestamp": #if($inputMap.timestamp) "$inputMap.timestamp" #else "$context.requestTimeInMs" #end,
  "requestId": "$context.requestId"
}
```

Here we use `#set` to assign the parsed input to a variable. Then we use `#if`/`#else` to include a timestamp from the input if it exists, otherwise we use the context's request timestamp in milliseconds. The `$context` object is another built-in object that contains metadata about the request itself, including the request ID, stage, and timing information.

Another common pattern is filtering or restructuring arrays. Imagine a client sends a list of items with extra metadata you don't need:

```json
{
  "items": [
    {"id": 1, "name": "Widget", "internalNote": "deprecated"},
    {"id": 2, "name": "Gadget", "internalNote": "new"}
  ]
}
```

You want to send only `id` and `name` to your backend:

```
#set($inputMap = $input.json('$'))
{
  "items": [
    #foreach($item in $inputMap.items)
    {
      "id": $item.id,
      "name": "$item.name"
    }#if($foreach.hasNext),#end
    #end
  ]
}
```

The `#foreach` directive iterates over the items array. Inside the loop, `$item` represents the current element. Notice the conditional `#if($foreach.hasNext),#end` at the end—this adds a comma between items but not after the last one, which is necessary for valid JSON. The `$foreach` object is automatically available within any foreach loop and provides metadata like `hasNext`.

### Response Mapping Templates: Transforming Outbound Data

Response mapping templates work on data flowing back from your backend. They're equally important for shaping what your API clients receive. Let's consider scenarios where the backend response needs transformation before reaching clients.

Suppose your backend service returns a response like this:

```json
{
  "statusCode": 200,
  "body": {
    "userId": "u123",
    "userName": "alice",
    "createdAt": "2024-01-15T10:30:00Z",
    "lastLogin": "2024-01-20T14:45:00Z"
  }
}
```

But your API contract promises clients a response with different field names and a simpler structure:

```json
{
  "id": "u123",
  "name": "alice",
  "created": "2024-01-15T10:30:00Z",
  "lastActive": "2024-01-20T14:45:00Z"
}
```

Your response mapping template would be:

```
#set($output = $output.json('$'))
{
  "id": "$output.body.userId",
  "name": "$output.body.userName",
  "created": "$output.body.createdAt",
  "lastActive": "$output.body.lastLogin"
}
```

Now consider a scenario where you need to handle errors gracefully. Your backend might return different status codes, and you want to customize the response accordingly:

```
#set($output = $output.json('$'))
#set($statusCode = $output.statusCode)
#if($statusCode == 200)
{
  "success": true,
  "data": {
    "userId": "$output.body.userId",
    "email": "$output.body.email"
  }
}
#elseif($statusCode == 400)
{
  "success": false,
  "error": "Invalid request",
  "details": "$output.body.message"
}
#elseif($statusCode == 404)
{
  "success": false,
  "error": "Resource not found"
}
#else
{
  "success": false,
  "error": "Unexpected error occurred"
}
#end
```

This template checks the status code and returns a different response structure depending on success or failure. This is particularly valuable for normalizing error responses across different backends.

Another pattern involves wrapping or unwrapping responses. If your backend returns just an array, but your API contract requires an object with metadata:

```
#set($items = $output.json('$'))
{
  "items": $items,
  "count": $items.size(),
  "timestamp": $context.requestTimeInMs,
  "requestId": "$context.requestId"
}
```

This wraps the array in an object and adds counts and metadata. Conversely, if the backend returns a wrapper object but clients expect the data directly, you'd extract the inner content.

### Common Transformation Patterns

Let's explore a few patterns you'll encounter repeatedly when working with mapping templates.

**Parsing CSV to JSON** is a classic requirement. Suppose a client sends comma-separated values as the request body (not JSON), and your backend needs structured data. VTL provides string manipulation tools for this. Here's how you might parse a CSV line:

```
#set($line = $input.body)
#set($fields = $line.split(','))
{
  "firstName": "$fields[0].trim()",
  "lastName": "$fields[1].trim()",
  "email": "$fields[2].trim()",
  "phone": "$fields[3].trim()"
}
```

The `split()` method breaks the string into an array, and `trim()` removes whitespace. This transforms unstructured CSV into structured JSON your backend can process.

**Extracting nested fields for path parameters** is another common need. If you're proxying requests to a REST service and the service endpoint includes an ID from the request body, mapping templates let you extract and use that ID:

```
#set($inputMap = $input.json('$'))
#set($userId = $inputMap.user.id)
/users/$userId/profile
```

By setting variables in the template, you can extract values from the body and use them in integration request paths. This is configured in the Integration Request settings where you can reference these extracted values.

**Conditional field inclusion** lets you build responses that include or exclude fields based on logic:

```
#set($output = $output.json('$'))
{
  "id": "$output.id",
  "name": "$output.name"
  #if($output.isAdmin),
  "adminLevel": "$output.adminLevel"
  #end
}
```

Notice the comma placement—it comes before the conditional field, not after. This avoids JSON syntax errors when fields are conditionally included.

**Type conversions and formatting** are frequently needed. VTL has limited type conversion, but you can coerce strings to numbers and manipulate them:

```
#set($count = $input.json('$.quantity'))
{
  "quantity": $count,
  "quantityStr": "$count",
  "doubled": #set($doubled = $count * 2)$doubled
}
```

Be careful with numeric operations—VTL can be finicky with type coercion. If you're doing complex arithmetic or formatting, it's often better to handle it in your Lambda function.

### Lambda Proxy vs Non-Proxy Integration

This is where understanding the integration type becomes crucial. API Gateway offers two ways to integrate with Lambda: Proxy integration and non-Proxy integration. The difference directly impacts how mapping templates work.

In a **non-Proxy integration**, you have full control through mapping templates. The request mapping template transforms the client request into the format your Lambda expects. Your Lambda returns data in whatever format, and the response mapping template transforms that output before returning it to the client. The flow is: client request → request mapping template → Lambda → response mapping template → client response.

Here's a concrete example. Your Lambda function expects:

```json
{
  "action": "getUser",
  "userId": 123
}
```

But clients send:

```json
{
  "operation": "getUser",
  "id": 123
}
```

Your request mapping template normalizes this:

```
{
  "action": "$input.json('$.operation')",
  "userId": $input.json('$.id')
}
```

The Lambda executes and returns:

```json
{
  "statusCode": 200,
  "user": {
    "id": 123,
    "name": "Alice"
  }
}
```

Your response mapping template transforms this to match your API contract:

```
{
  "success": true,
  "user": $output.json('$.user')
}
```

In a **Proxy integration**, the mapping template stage is largely bypassed. Lambda is responsible for returning the complete HTTP response, including status code, headers, and body, in a specific format:

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\"success\": true, \"user\": {...}}"
}
```

When you use Proxy integration, API Gateway passes the entire request object to Lambda (including body, headers, path parameters, query parameters) as a single event object. Lambda returns this HTTP response structure, and API Gateway uses it directly with minimal transformation. You *can* have mapping templates with Proxy integration, but they're typically simpler and less commonly used because the Lambda handles most of the transformation logic.

The choice between Proxy and non-Proxy comes down to where you want your transformation logic to live. Non-Proxy integration keeps it in API Gateway where it's easier to debug and version separately. Proxy integration keeps it in Lambda where you have more programming flexibility. For complex transformations, Proxy integration often wins. For simple transformations where you want to shield your backend from client changes, non-Proxy is cleaner.

### Debugging Mapping Templates with Test Invocations

One of the most practical skills for working with mapping templates is effective debugging. The API Gateway console provides a test invocation feature that's invaluable for troubleshooting templates without deploying to your actual API.

In the API Gateway console, navigate to your resource and method, then click the Test button. You'll see a form where you can input:

- Query string parameters
- Path parameters
- Headers
- Request body

When you execute the test, the console shows you exactly what the mapping template outputs. This is your primary debugging tool. If your transformation isn't producing the expected output, you can iteratively refine the template and re-test until it's correct.

One debugging technique is to use VTL's `#set` directive to store intermediate results, then output them to see what values you're actually working with. For example:

```
#set($inputMap = $input.json('$'))
#set($userId = $inputMap.user.id)
#set($email = $inputMap.user.email)
{
  "DEBUG_userId": "$userId",
  "DEBUG_email": "$email",
  "actualData": {
    "id": "$userId",
    "emailAddress": "$email"
  }
}
```

When you test this, you'll see the DEBUG fields with the extracted values. This helps you confirm that `$input.json()` is parsing correctly and extracting what you expect. Once confident, you'd remove the debug fields.

Another debugging tip: when working with nested JSON, use `$input.path()` to verify specific values exist before trying to use them in more complex logic. For instance, if you're not sure whether the email field exists at `$.contact.email`, test with `$input.path('$.contact.email')` first.

The CloudWatch logs for your API can also provide clues. When a mapping template fails, API Gateway logs the error. However, these errors are often generic ("mapping template failed"), so the console test invocation is really your best friend for pinpointing issues before they hit production.

### Integration with AWS Services

Mapping templates aren't just for Lambda or HTTP endpoints. API Gateway can integrate directly with many AWS services, and mapping templates are essential for bridging the gap between your API contract and each service's API.

Consider integrating with DynamoDB. DynamoDB's API expects requests in a specific format with action and payload. If your API clients send a simple JSON object, you need a mapping template to translate that into DynamoDB's request format:

```
{
  "TableName": "Users",
  "Key": {
    "userId": {
      "S": "$input.json('$.id')"
    }
  }
}
```

DynamoDB uses type descriptors (like `"S"` for string, `"N"` for number), so the mapping template formats the request correctly.

Similarly, integrating with SNS (Simple Notification Service) requires translating your API request into SNS's message format:

```
{
  "TopicArn": "arn:aws:sns:us-east-1:123456789012:MyTopic",
  "Message": "$input.json('$.message')",
  "Subject": "$input.json('$.subject')"
}
```

The response from these AWS service integrations also needs transformation. SNS returns an XML response (not JSON), so your response mapping template needs to parse that:

```
#set($inputRoot = $input.path('$'))
{
  "messageId": "$inputRoot.PublishResponse.PublishResult.MessageId"
}
```

This demonstrates that mapping templates work with any integration backend—Lambda, HTTP, or AWS services—giving you consistent transformation capabilities across all integration types.

### VTL Best Practices and Limitations

When writing mapping templates, keep a few best practices in mind. First, always use `#set` to assign parsed values to variables rather than calling parsing methods repeatedly. This is more efficient and makes your template more readable:

```
#set($body = $input.json('$'))
#set($userId = $body.user.id)
#set($email = $body.user.email)
```

Rather than:

```
$input.json('$.user.id')
$input.json('$.user.email')
```

Second, handle missing fields gracefully. VTL won't throw an error if you reference a non-existent field—it just returns an empty string. This can lead to subtle bugs. Use conditional logic to detect missing fields:

```
#if($body.email)
"email": "$body.email"
#else
"email": "no-email@example.com"
#end
```

Third, remember that mapping templates output text, not objects. When you write `$variable` without quotes, VTL outputs the value as-is (useful for numbers and booleans). When you write `"$variable"`, the value is quoted as a string. This matters for JSON validity:

```
"count": 5,
"name": "Alice"
```

These are produced by:

```
"count": #set($count = 5)$count,
"name": "$input.json('$.name')"
```

Understanding text output vs. structured values prevents JSON parsing errors.

Finally, be aware of VTL's limitations. It's not a full programming language—you can't define functions or complex algorithms. For transformations requiring significant logic, Proxy integration with Lambda is often a better choice. However, for straightforward field mapping, filtering, and restructuring, VTL is perfect and keeps transformation logic out of your application code.

### Conclusion

Request and response mapping templates are a sophisticated yet accessible tool in the API Gateway toolkit. By mastering Velocity Template Language and understanding the `$input` and `$output` objects, you gain the ability to decouple client-facing API contracts from backend service implementations. Whether you're normalizing data formats, extracting fields for routing, handling errors, or integrating with AWS services, mapping templates give you precise control over data transformation in flight.

The key is practice. Start with simple field mappings, gradually explore conditionals and loops, and use the console test invocation feature liberally as you develop templates. Pay attention to whether you're using Proxy or non-Proxy integration, as this affects where your transformation logic lives. With these patterns and practices in hand, you'll be able to build flexible, maintainable APIs that evolve independently of their backend implementations.
