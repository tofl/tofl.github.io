---
title: "Lambda Layers: Sharing Code and Dependencies Across Functions"
---

## Lambda Layers: Sharing Code and Dependencies Across Functions

Building serverless applications means managing dependencies and shared code across multiple Lambda functions. Without a clean way to share libraries, you'll end up duplicating code, inflating function packages, and creating a maintenance nightmare. AWS Lambda Layers solve this problem elegantly by allowing you to package code and dependencies separately from your function logic, then attach those layers to one or many functions. In this guide, we'll explore how to create, publish, and consume Lambda Layers effectively, and how they fit into modern serverless architectures.

### Understanding Lambda Layers

A Lambda Layer is essentially a package of libraries, custom code, or other content that can be used by Lambda functions. When you attach a layer to a function, AWS extracts the layer's contents into the execution environment at a predictable path, making those resources available to your function code. Think of a layer as a reusable archive that your function can depend on without having to bundle everything into the function's deployment package.

The real power of layers becomes apparent when you need to share the same dependencies or utilities across multiple functions. Instead of packaging a 50 MB dependency library into ten different function ZIP files, you create a single layer, attach it to all ten functions, and suddenly you've saved significant storage and reduced deployment complexity. You can also attach up to five layers to a single function, allowing you to compose functionality in flexible ways—one layer for your company's shared utilities, another for a specific framework, and another for monitoring or logging code.

### Runtime-Specific Directory Structure

The key to using Lambda Layers correctly lies in understanding how each runtime expects files to be organized. When you create a layer, you're building a ZIP file with a specific directory structure that AWS extracts into a predictable location during function execution.

For **Python**, the directory structure is straightforward. Any Python packages should live in a `python` directory at the root of your ZIP file. When the layer is extracted into the execution environment, these packages become importable because the `python` directory is added to the Python path. If you're including a package called `requests`, your layer ZIP should contain `python/lib/python3.x/site-packages/requests/`. The easiest way to create this structure is to install your dependencies into a local `python/lib/python3.x/site-packages/` directory and then ZIP the entire `python` folder.

For **Node.js**, the convention is to use a `nodejs` directory at the root of your ZIP, and within that directory, your node modules go into `nodejs/node_modules/`. So if you're bundling the `uuid` package, your layer ZIP should have `nodejs/node_modules/uuid/` at the appropriate depth. This mirrors how Node.js normally resolves modules from a `node_modules` directory.

For **Java**, the structure is slightly different because Java's class loading model is distinct. JAR files should be placed in a `java/lib/` directory in your layer ZIP. These JAR files are added to the classpath when your Lambda function executes, making all classes available for import.

Other runtimes like Go, Ruby, and .NET have their own conventions, but the principle remains the same: organize your layer contents in a directory structure that matches the runtime's expectations and where the runtime will naturally look for these files.

### Creating and Packaging Layers

Let's walk through a practical example. Suppose you have a Python function that needs the `requests` library and a custom utility module that multiple functions will use. You'd create a directory structure like this:

```
my-layer/
├── python/
│   └── lib/
│       └── python3.11/
│           └── site-packages/
│               ├── requests/
│               ├── urllib3/
│               └── my_utilities.py
```

To create this structure, you might start by installing dependencies into a temporary directory:

```bash
mkdir -p layer/python/lib/python3.11/site-packages
pip install requests -t layer/python/lib/python3.11/site-packages/
cp my_utilities.py layer/python/lib/python3.11/site-packages/
cd layer
zip -r ../my-layer.zip .
cd ..
```

For a Node.js layer, the equivalent process looks like this:

```bash
mkdir -p layer/nodejs/node_modules
cd layer/nodejs
npm install uuid lodash
cd ../..
zip -r my-layer.zip layer/
```

Once you have your ZIP file, publishing it as a layer is straightforward. You use the AWS CLI to call the `publish-layer-version` command:

```bash
aws lambda publish-layer-version \
  --layer-name my-shared-layer \
  --zip-file fileb://my-layer.zip \
  --compatible-runtimes python3.11 python3.12 \
  --region us-east-1
```

This command creates a new version of the layer and returns the layer ARN (Amazon Resource Name) that you'll use when attaching the layer to functions. Notice the `--compatible-runtimes` parameter—this is optional but helpful for documenting and validating which runtimes your layer supports.

### Layer Versioning and Immutability

An important characteristic of Lambda Layers is that they're immutable. Once you publish a version, you cannot modify it. This immutability is actually a feature, not a limitation. It ensures that when you attach version 3 of a layer to a function, that function will always use exactly that version of the layer's contents, even if version 4 is published later.

When you update a layer—say, you've patched a security vulnerability in a dependency—you publish a new version. AWS automatically increments the version number. You can then update functions to use this new version, but the old version remains available and unchanged. This is crucial for maintaining stability in production environments. You might have some functions on version 2 of a layer while others have already migrated to version 3, and both work correctly without interfering with each other.

To update a function to use a new layer version, you can use the CLI:

```bash
aws lambda update-function-configuration \
  --function-name my-function \
  --layers arn:aws:lambda:us-east-1:123456789012:layer:my-shared-layer:3 \
  --region us-east-1
```

You can view all versions of a layer and manage them through the AWS Console or by using the `list-layer-versions` CLI command.

### Attaching Layers to Functions

Attaching a layer to a function is simple and can be done at function creation time or later. When creating a function via the CLI, you'd include the layers parameter:

```bash
aws lambda create-function \
  --function-name my-function \
  --runtime python3.11 \
  --role arn:aws:iam::123456789012:role/lambda-execution-role \
  --handler index.handler \
  --zip-file fileb://function.zip \
  --layers arn:aws:lambda:us-east-1:123456789012:layer:my-shared-layer:1 \
  --region us-east-1
```

You can attach multiple layers in a single command by repeating the `--layers` parameter:

```bash
aws lambda update-function-configuration \
  --function-name my-function \
  --layers \
    arn:aws:lambda:us-east-1:123456789012:layer:my-shared-layer:1 \
    arn:aws:lambda:us-east-1:123456789012:layer:monitoring-layer:2 \
    arn:aws:lambda:us-east-1:123456789012:layer:custom-runtime-layer:1
```

The order in which you specify layers matters because they're extracted into the function's environment in order, and if there are any file conflicts, the later layers take precedence. This gives you fine control over how code is composed.

### Sharing Layers Across AWS Accounts

One of the most powerful features of Lambda Layers is the ability to share them across AWS accounts. This is invaluable for organizations with multiple AWS accounts—development, staging, production—or for sharing utility layers across different teams.

To share a layer with another AWS account, you use resource-based permissions. First, you publish the layer in the source account:

```bash
aws lambda publish-layer-version \
  --layer-name shared-utilities \
  --zip-file fileb://utilities.zip \
  --compatible-runtimes python3.11 \
  --region us-east-1
```

Then, you add a resource policy to the layer allowing the target account to read it:

```bash
aws lambda add-layer-version-permission \
  --layer-name shared-utilities \
  --version-number 1 \
  --statement-id allow-external-account \
  --action lambda:GetLayerVersion \
  --principal arn:aws:iam::987654321098:root \
  --region us-east-1
```

In the target account, users can now reference the layer by its full ARN when creating or updating functions. The key permission here is `lambda:GetLayerVersion`, which allows the external account to retrieve and use the layer.

### Common Patterns and Use Cases

Lambda Layers excel in several common patterns. The most straightforward is **shared dependency management**. When you have a set of commonly used libraries—like a logging framework, HTTP client, or data validation library—you package them into a layer once and attach that layer to all functions that need them. This reduces function package size and centralizes dependency management.

Another powerful pattern is **shared utility libraries**. You might create a layer containing custom functions that multiple teams use: database connection helpers, authentication utilities, response formatting functions, or business logic primitives. By placing these in a shared layer, you ensure consistency across your application and make updates centrally rather than duplicating code across dozens of functions.

The **vendored dependencies** pattern addresses the scenario where you want to include a specific version of a dependency without relying on package managers at runtime. This is particularly useful for ensuring reproducible builds and avoiding runtime dependency resolution failures. You vendor the entire dependency tree into the layer, guaranteeing that the exact same code runs in every deployment.

You might also use layers for **lightweight runtime additions**. For example, you could create a layer that includes a custom log formatter, custom metrics library, or even a small compiled binary that your functions invoke. This keeps your function code clean and focused while adding cross-cutting concerns through layers.

### A Practical Python Example

Let's build a concrete example. Imagine you're building a microservices application where multiple Lambda functions need to log structured events and make HTTP requests. You decide to create a shared layer containing `requests`, `python-json-logger`, and a custom `app_utilities` module.

First, set up the directory structure:

```bash
mkdir -p lambda-layer/python/lib/python3.11/site-packages
cd lambda-layer/python/lib/python3.11/site-packages

pip install requests python-json-logger --target .

cat > app_utilities.py << 'EOF'
import logging
from pythonjsonlogger import jsonlogger

def setup_logging():
    logger = logging.getLogger()
    handler = logging.StreamHandler()
    formatter = jsonlogger.JsonFormatter()
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    return logger

def make_secure_request(url, timeout=5):
    import requests
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        raise RuntimeError(f"Request failed: {str(e)}")
EOF

cd ../../../..
zip -r shared-layer.zip lambda-layer/
```

Now publish the layer:

```bash
aws lambda publish-layer-version \
  --layer-name shared-utilities \
  --zip-file fileb://shared-layer.zip \
  --compatible-runtimes python3.11
```

In your function code, you can now use these utilities without including them in your deployment package:

```python
import json
from app_utilities import setup_logging, make_secure_request

logger = setup_logging()

def handler(event, context):
    logger.info("Processing event", extra={"event": event})
    
    try:
        data = make_secure_request("https://api.example.com/data")
        return {
            "statusCode": 200,
            "body": json.dumps(data)
        }
    except RuntimeError as e:
        logger.error(str(e))
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }
```

Your function code becomes cleaner and smaller because the heavy lifting is in the layer, and you can reuse this layer across dozens of functions.

### Best Practices and Considerations

When working with Lambda Layers, a few best practices will serve you well. First, keep layers focused and cohesive. Rather than creating one monolithic layer with everything, create layers around specific concerns: one for data access, one for logging, one for authentication. This makes it easier to update and version them independently.

Be mindful of layer size. Lambda functions and layers have a combined uncompressed size limit of 250 MB. While this is generous, it's still possible to exceed it if you're not careful. Monitor your layer sizes and avoid including unnecessary files.

Document the purpose and compatibility of each layer. Use meaningful names and descriptions, and clearly note which runtimes each layer supports. This saves your teammates from guessing why a layer exists or whether it'll work with their function's runtime.

Version your layers intentionally. Don't just publish a new version every time you make a tiny change; instead, follow semantic versioning conventions. Major version increments for breaking changes, minor for new non-breaking features, and patches for bug fixes. This makes it clear when you can safely upgrade and when you need to test more thoroughly.

Test layers thoroughly before deploying them to production. Create a test function, attach the layer, and verify that all imports work and functionality behaves as expected. Pay special attention to version conflicts—if your layer pins a dependency to a specific version and your function code expects a different version, you'll have problems.

Finally, consider using layers with Infrastructure as Code tools like AWS CloudFormation or Terraform. You can define both your layers and your functions in code, making your entire serverless architecture reproducible and version-controlled.

### Troubleshooting Common Issues

The most common issue developers encounter is the dreaded "module not found" error. This almost always stems from incorrect directory structure in the layer ZIP file. Double-check that your Python packages are in `python/lib/python3.x/site-packages/`, not just `python/site-packages/` or some other variant. For Node.js, verify that your modules are in `nodejs/node_modules/`.

Another frequent problem is attempting to attach more than five layers to a single function. AWS enforces a hard limit of five layers per function. If you find yourself needing more, it's a sign that you should consolidate your layers or reconsider your architecture.

You might also encounter permission issues when sharing layers across accounts. Verify that the resource policy allows the correct action (`lambda:GetLayerVersion`) and that the principal ARN is correct. A common mistake is using an IAM user or role ARN instead of the account root ARN.

Finally, remember that layers are immutable. If you publish a layer and immediately realize there's an error, you can't fix it in place—you must publish a new version. This is why testing before publishing is crucial.

### Conclusion

Lambda Layers transform how you manage code and dependencies in serverless applications. By enabling code reuse, centralizing dependency management, and supporting cross-account sharing, layers help you build more maintainable and scalable serverless architectures. Whether you're sharing a custom utility library across your organization, managing vendored dependencies, or adding lightweight runtime enhancements, understanding how to create, version, and attach layers is essential for effective AWS Lambda development.

The key takeaways are straightforward: structure your layers according to your runtime's conventions, publish them with clear versioning, attach up to five layers per function to compose functionality flexibly, and leverage resource-based permissions to share layers across accounts. As you continue building with Lambda, you'll find that well-designed layers become foundational to your development workflow, reducing code duplication and making your entire serverless application more cohesive and maintainable.
