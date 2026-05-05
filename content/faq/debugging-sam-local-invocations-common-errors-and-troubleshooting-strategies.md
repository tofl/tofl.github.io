---
title: "Debugging SAM Local Invocations: Common Errors and Troubleshooting Strategies"
---

## Debugging SAM Local Invocations: Common Errors and Troubleshooting Strategies

When you're developing serverless applications with AWS SAM (Serverless Application Model), your local development loop becomes critical to iteration speed and confidence. Running `sam local invoke` and `sam local start-api` lets you test Lambda functions on your machine before deploying to AWS—but things can go wrong in ways that aren't immediately obvious. The Docker daemon refuses to connect, your event payloads don't match what the handler expects, layers won't resolve, or your function mysteriously can't reach a VPC resource. These issues frustrate developers because they interrupt the feedback loop and can feel like black boxes if you don't know where to look.

This guide walks you through the most common problems you'll encounter when running SAM local invocations, explains why they happen, and shows you concrete solutions. By the end, you'll have the mental model and practical techniques to diagnose and fix issues quickly, keeping your development velocity high.

### Understanding the SAM Local Development Model

Before diving into troubleshooting, it's worth understanding what `sam local` actually does. When you run `sam local invoke` or `sam local start-api`, SAM orchestrates Docker containers to simulate Lambda execution on your machine. It pulls the appropriate AWS Lambda runtime container image, mounts your function code inside it, and executes your handler in an environment that closely mirrors the actual Lambda service.

This architecture is powerful—it lets you test your code in an environment nearly identical to production—but it also introduces complexity. You're now managing container images, networking, environment variable propagation, and file system mounts. Each of these layers can fail independently, and understanding which layer is broken is key to fixing the issue quickly.

### Docker Daemon Connection Errors

The most common failure point when first setting up SAM local development is the Docker daemon itself. Your machine needs a running Docker daemon for SAM to create and run containers.

#### Docker: Command Not Found

This error appears when you run `sam local invoke` and SAM tries to talk to Docker:

```
Error: Error building image. docker: command not found
```

This typically means Docker Desktop (on macOS or Windows) isn't running, or Docker isn't installed. Open Docker Desktop and wait for it to fully start—you'll see a small whale icon in your menu bar on macOS or system tray on Windows. On Linux, verify the Docker daemon is running with `systemctl status docker`.

Sometimes the error persists even when Docker Desktop appears to be running. On macOS, Docker Desktop might be running but the Docker CLI isn't in your PATH. Try this diagnostic:

```bash
which docker
```

If it returns nothing, Docker CLI isn't accessible. Reinstalling Docker Desktop usually fixes this. On Linux, ensure your user is in the docker group:

```bash
sudo usermod -aG docker $USER
newgrp docker
```

After making this change, log out and back in, or start a new terminal session.

#### Cannot Connect to Docker Daemon

Sometimes Docker is installed and appears to be running, but SAM still can't reach it:

```
error during connect: This error may indicate that the docker daemon is not running or you do not have permission to access it
```

On Linux, this error almost always means your user doesn't have permission to access the Docker socket at `/var/run/docker.sock`. Use the `usermod` command shown above.

On macOS, Docker Desktop might have crashed or become unresponsive. Try restarting it entirely: quit it from the menu, then reopen it. Wait a full minute for it to complete its startup sequence.

You can verify Docker is actually responsive by running a simple test:

```bash
docker ps
```

If this hangs or times out, the daemon is stuck. Restart Docker Desktop completely.

#### Docker Desktop Running Out of Resources

If you're running multiple local SAM invocations simultaneously, or your function's Docker container needs significant CPU or memory, Docker Desktop might not have enough resources allocated. This manifests as extremely slow invocations or mysterious timeouts.

On macOS or Windows, open Docker Desktop settings, go to the Resources tab, and increase the allocated CPU cores and memory. Start with at least 4 CPU cores and 4 GB of RAM. You can observe actual usage in the Docker Desktop dashboard.

### Event Payload Mismatches

Your Lambda handler expects a specific event structure. When you invoke a function with `sam local invoke`, you must provide an event that matches this structure, or the handler fails.

#### Missing or Incorrect Event File

By default, `sam local invoke` looks for an event file at `events/event.json`. If this file doesn't exist or is in the wrong format, you'll see:

```
Error: Event file not found at events/event.json
```

Create the events directory in your project root and add an event file. The structure depends on what triggers your function. For an API Gateway trigger, an event looks like:

```json
{
  "httpMethod": "GET",
  "path": "/hello",
  "headers": {
    "Content-Type": "application/json"
  },
  "queryStringParameters": {
    "name": "World"
  },
  "body": null,
  "isBase64Encoded": false
}
```

For an S3 trigger, it's entirely different:

```json
{
  "Records": [
    {
      "s3": {
        "bucket": {
          "name": "my-bucket"
        },
        "object": {
          "key": "uploaded-file.txt"
        }
      }
    }
  ]
}
```

Specify a custom event file with the `--event` flag:

```bash
sam local invoke MyFunction --event events/custom-event.json
```

#### Type Mismatches in Event Payload

Sometimes the event file is present but structured incorrectly. Your handler receives the event and immediately fails because it expects certain fields or types. For example, if your handler expects a JSON string in the body and receives an empty object, you might see an error like:

```
TypeError: 'NoneType' object is not subscriptable
```

or in Node.js:

```
TypeError: Cannot read property 'message' of undefined
```

This usually means your event payload doesn't match the handler's expectations. Check your handler code to see what fields it accesses. In Python, if your handler does `json.loads(event['body'])`, the `body` field must be present and must be a JSON string, not an object.

Print the entire event at the start of your handler as a debugging step:

```python
def lambda_handler(event, context):
    print(f"Received event: {json.dumps(event)}")
    # Rest of handler code
```

When you run `sam local invoke`, SAM outputs the handler's print statements to stdout, so you'll see exactly what the handler received. Compare this to your expectations and adjust the event file accordingly.

### Handler Import and Module Resolution Errors

Your handler references imported modules, and SAM must successfully load those imports before the handler runs. This is where layer path resolution and Python path management become important.

#### Handler Not Found or Import Error

You might see an error like:

```
Error: Unable to import module 'index': No module named 'requests'
```

or

```
Could not find handler definition in index.handler
```

The first error means your handler file exists but imports a module that's not available. The second means SAM can't find the handler file itself.

For missing imports, first verify the module is installed in your project's dependencies. In Python, if you're using pip, make sure `requests` is in your `requirements.txt`:

```
requests==2.28.0
```

Then run `pip install -r requirements.txt` locally to verify it installs without errors.

For the handler not found error, check your SAM template. The handler property must match your actual file and function name. In `template.yaml`:

```yaml
Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.lambda_handler
      Runtime: python3.11
      CodeUri: src/
```

This tells SAM to look for a file named `index.py` (or `index.js`, etc., depending on runtime) in the `src/` directory, and inside that file, a function named `lambda_handler`. If the actual file is named `handler.py` or the function is named `main`, SAM won't find it.

#### Import Errors with Layers

Layers are a common source of import confusion. When you define a layer in your template, SAM must resolve its path correctly at local invocation time.

```yaml
Layers:
  - !Ref MyUtilityLayer
```

If SAM can't find the layer, you'll see an error during the build phase. Verify that the layer's `CodeUri` points to the correct directory. For Python layers, the structure must be:

```
my-layer/
  python/
    mymodule.py
    utils/
      __init__.py
      helper.py
```

The `python/` directory is critical—SAM mounts this into the Lambda function's Python path. Without it, imports fail. For Node.js layers, use `nodejs/node_modules/`:

```
my-layer/
  nodejs/
    node_modules/
      my-package/
        index.js
```

When you run `sam local invoke`, SAM automatically builds and mounts layers. However, if you've made changes to layer code, you might need to force a rebuild:

```bash
sam build --use-container
```

The `--use-container` flag ensures layers are built in a Docker environment matching the Lambda runtime, avoiding issues where your local Python or Node.js version differs from Lambda's.

### Environment Variable Propagation

Lambda functions often rely on environment variables to access secrets, configuration, or resource identifiers. When you test locally with `sam local invoke`, these variables must be available inside the container, or your function fails with undefined variable errors.

#### Variables Not Available in Container

Suppose your handler expects `DB_HOST` and `DB_PASSWORD` from environment variables:

```python
def lambda_handler(event, context):
    host = os.environ['DB_HOST']
    password = os.environ['DB_PASSWORD']
    # Use them...
```

If these aren't set, you'll see:

```
KeyError: 'DB_HOST'
```

Define environment variables in your `template.yaml` under the function's `Environment` property:

```yaml
Resources:
  MyFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: index.lambda_handler
      Runtime: python3.11
      CodeUri: src/
      Environment:
        Variables:
          DB_HOST: localhost
          DB_PASSWORD: local-password
          LOG_LEVEL: DEBUG
```

When you run `sam local invoke`, SAM reads these variables and passes them into the container. For local development, you can use dummy values or local resources. In production (after deployment), you'd override these via the AWS console or deployment parameters.

#### Secrets Manager Integration

If you're using Secrets Manager to provide sensitive values, local testing becomes more complex. SAM doesn't automatically fetch Secrets Manager values during local invocation. You have a few options:

Create a local environment file and reference it during invocation:

```bash
sam local invoke MyFunction --env-vars env.json
```

The `env.json` file contains the variables:

```json
{
  "MyFunction": {
    "DB_PASSWORD": "local-test-value"
  }
}
```

Alternatively, in `template.yaml`, parameterize environment variables and override them locally. But for genuine Secrets Manager integration testing, you might need to either mock the Secrets Manager API or use a local version if you're in a corporate environment with test credentials.

### Network Connectivity and VPC Resources

Functions running in a VPC can access resources like RDS databases or ElastiCache clusters, but only if network connectivity is properly configured. When you run `sam local invoke`, your function container must reach those resources, which is often impossible from localhost.

#### Unable to Connect to VPC Resources

If your handler tries to connect to an RDS database and you get a timeout:

```
ConnectionError: Unable to connect to rds.example.com:5432
```

The container can't reach that resource because it's in a VPC that your local machine isn't part of. There's no easy fix for this during local development. Your options are:

Mock the resource's responses. Refactor your handler to accept a database connection object, then inject a mock version during local testing. This is excellent practice for testability anyway.

Use an AWS Lambda function in the actual AWS environment for integration testing. Local invocation is great for unit tests, but integration tests with VPC resources should run in AWS.

If you have VPN access to the corporate network where the VPC exists, you might be able to connect locally. But this is rare and often not worth the setup complexity.

#### Port Conflicts on localhost

When you run `sam local start-api`, SAM starts an API Gateway emulator on port 3000 by default. If something else is already listening on that port, you'll see:

```
ERROR: Unable to bind port 3000. Address already in use.
```

Specify a different port:

```bash
sam local start-api --port 8080
```

Now the API listens on `http://localhost:8080`.

To find what's using port 3000, on macOS or Linux:

```bash
lsof -i :3000
```

This lists the process using that port. You can then kill it or choose a different port.

### Enabling Verbose Logging for Diagnosis

When you're stuck on an error message that doesn't clearly explain the problem, verbose logging reveals what SAM is actually doing behind the scenes.

#### Debug Flag

Add the `--debug` flag to any SAM command:

```bash
sam local invoke MyFunction --debug
```

This outputs detailed logging to stderr, showing Docker commands being executed, environment variables being set, and the full exception traceback if something fails. The output is verbose—often hundreds of lines—but it frequently reveals the actual root cause.

For even more detail, set the `SAM_CLI_TELEMETRY` environment variable:

```bash
SAM_CLI_TELEMETRY=0 sam local invoke MyFunction --debug
```

The `SAM_CLI_TELEMETRY=0` disables telemetry, reducing noise in the output.

#### Viewing Function Output

When your handler prints debug information, these outputs appear in the SAM CLI output. Make sure your handler is actually logging what you expect. In Python:

```python
import json
import logging

logger = logging.getLogger()
logger.setLevel(logging.DEBUG)

def lambda_handler(event, context):
    logger.debug(f"Event received: {json.dumps(event)}")
    logger.info("Processing request")
    # Handler logic
    return {"statusCode": 200, "body": "Success"}
```

The logger output appears in the SAM CLI when you invoke the function.

#### Docker Build Logs

If the error happens during the Docker build phase, SAM might not be showing you the full Docker output. Force SAM to use the container build process and see Docker output:

```bash
sam build --use-container --debug
```

This shows Docker's layer-by-layer build process, which helps identify if dependencies failed to install.

### Practical Troubleshooting Workflow

When you hit an error, follow this systematic approach:

Start by running with verbose logging. Use `--debug` to see what SAM is actually doing. This often reveals the immediate cause.

Check the Docker daemon. Verify Docker Desktop is running with `docker ps`. If it hangs or fails, restart Docker.

Validate your event payload. Print it in the handler and compare to what the handler expects. Make sure JSON is valid and fields match.

Check handler configuration. Verify the handler path in `template.yaml` exactly matches your file and function names. Watch for off-by-one errors in paths or typos.

Verify dependencies. Ensure all imported modules are in `requirements.txt` (Python) or `package.json` (Node.js), and run `sam build` to confirm they install.

Confirm environment variables. Print `os.environ` in your handler to see what variables are actually set inside the container. Compare to your template configuration.

Test in isolation. If your handler calls external services, mock those calls locally first. Test the handler logic before testing integration.

Consider the network boundary. If your handler tries to connect to VPC resources, recognize that local invocation can't reach them. Mock or skip those tests locally.

### Common Error Messages and Quick Fixes

**"docker: command not found"** — Docker Desktop isn't installed or isn't in your PATH. Reinstall Docker Desktop.

**"Cannot connect to Docker daemon"** — Docker daemon isn't running. Start Docker Desktop. On Linux, ensure your user is in the docker group.

**"Event file not found at events/event.json"** — Create the events directory and add an event file. Specify a custom event with `--event`.

**"Unable to import module 'handler'"** — Check the Handler property in template.yaml matches your actual file name and function name.

**"No module named 'requests'"** — Add the module to requirements.txt and run `sam build`.

**"KeyError: 'DB_HOST'"** — Define environment variables in template.yaml under the function's Environment property.

**"Unable to bind port 3000"** — Use `--port 8080` (or another port) when running `sam local start-api`.

**"ConnectionError: Unable to connect to rds.example.com"** — Mock VPC resources for local testing. Integration tests belong in AWS.

### Conclusion

Debugging SAM local invocations requires understanding the layers involved—the Docker daemon, event payload structure, module imports, environment variable propagation, and network connectivity. Most errors fall into one of these categories, and once you identify which layer is broken, the fix is usually straightforward.

The key is developing a diagnostic routine: use verbose logging early, validate inputs systematically, and recognize the boundary between what can be tested locally (handler logic, event processing) and what belongs in AWS (VPC connectivity, cross-service integration). By mastering these troubleshooting techniques, you'll spend less time debugging and more time building serverless applications with confidence.
