---
title: "Building Custom Lambda Runtimes with the Runtime API"
---

## Building Custom Lambda Runtimes with the Runtime API

When you think of AWS Lambda, you probably picture Node.js, Python, Java, or Go humming along in the cloud. These are the officially supported runtimes—the ones you can select from a dropdown menu and start coding immediately. But what if you want to deploy Rust for its performance, PHP for legacy application integration, or even COBOL for compliance-heavy enterprise systems? The answer lies in custom runtimes: a powerful, albeit more complex, mechanism that lets you bring virtually any language to Lambda.

Building a custom runtime isn't something most developers need to do on their first day with Lambda. It's an advanced topic, one that requires understanding how AWS has abstracted away the underlying infrastructure and how you can hook your own code into that abstraction. Yet once you grasp the mechanics, you gain tremendous flexibility—and perhaps more importantly, you develop a deeper appreciation for how Lambda actually works under the hood.

This guide will walk you through the Runtime API, explain the bootstrap contract that your custom runtime must fulfill, and show you how to build a minimal but functional custom runtime from the ground up. We'll also explore why container images are often the more pragmatic choice for many scenarios.

### Understanding the Lambda Execution Model

Before diving into custom runtimes, it helps to understand what Lambda is really doing when it invokes your function. Every Lambda invocation follows a sequence: the execution environment starts, your code runs, and the result (or error) is reported back to the Lambda service. This flow is the same whether you're running Python or a custom runtime—the only difference is how that execution environment is bootstrapped and how your code is invoked.

In the standard runtimes provided by AWS, a Lambda-managed process called the *runtime* sits between the Lambda platform and your handler code. This runtime listens for invocation events, deserializes the payload, calls your handler, serializes the response, and reports it back. Think of it as a bridge—your handler doesn't directly communicate with Lambda; the runtime does the translation.

Custom runtimes follow the exact same pattern. The critical insight is that **you** are responsible for building that bridge. AWS provides the contract—a set of HTTP endpoints—but you have to implement the logic that respects those endpoints.

### The Lambda Runtime API Contract

The Lambda Runtime API is elegantly simple: it's just a set of HTTP endpoints that your runtime must call at specific times. These endpoints run on a local HTTP server that AWS bootstraps for you, and they're accessible via environment variables that Lambda injects into your execution environment.

The primary environment variable you need is `AWS_LAMBDA_RUNTIME_API`, which contains the endpoint address (typically something like `127.0.0.1:9001`). Your custom runtime uses this to construct URLs and make HTTP requests to retrieve events and send responses.

#### The Invocation Cycle

The invocation cycle consists of three main HTTP operations:

**Getting the next invocation** is where everything starts. Your runtime calls `GET http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/next`. This is a blocking call—it will hang until an invocation is available. When Lambda has an event to process, this endpoint returns with a 200 status code and a JSON body containing the event payload. Critical response headers include `Lambda-Runtime-Function-Arn` (identifying the function), `Lambda-Runtime-Aws-Request-Id` (a unique identifier for this invocation), and others that provide context about the invocation.

**Sending the response** happens after your handler code runs successfully. You `POST` to `http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/{RequestId}/response`, where `{RequestId}` is the request ID from the invocation event. The body should be JSON containing whatever your handler returned. Lambda then delivers this to the caller—whether that's a synchronous API call, an asynchronous event queue, or anything in between.

**Reporting errors** is just as important as reporting success. If your handler throws an exception or something goes wrong, you `POST` to `http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/{RequestId}/error`. The body should be JSON describing the error, typically with a `errorMessage` and `errorType` field. Lambda will then report this as a failed invocation, complete with your error information.

There's also an initialization error endpoint at `http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/init/error`, which you call if something breaks during the bootstrap phase before you even start listening for invocations. This is useful if your custom runtime itself fails to initialize—you can report that failure clearly.

### The Bootstrap Executable: Your Entry Point

Every custom runtime begins with a bootstrap executable. This is the file that Lambda actually runs when your function starts. It's the first thing that executes, and it's responsible for setting up your custom runtime and starting the invocation loop.

The bootstrap executable can be written in any language that your execution environment supports. Since Lambda runs on Amazon Linux 2, you can use compiled binaries (like Rust, Go, or C), shell scripts, or even a polyglot approach where a shell script invokes an interpreter.

The bootstrap file must be named exactly `bootstrap` (no extension) and must be executable. When you package your function, you place it at the root of your deployment package (or at the root of your container image if you're using container images). Lambda sets the `LAMBDA_TASK_ROOT` environment variable to point to the directory containing your code, so your bootstrap can reference other files relative to that path.

Here's the essential contract that your bootstrap must fulfill:

1. **It must start** without raising an error. If the bootstrap fails to execute or exits before it should, Lambda treats this as an initialization error.

2. **It must enter an event loop** where it repeatedly calls the "next invocation" endpoint, processes the event, and sends back a response or error. This loop runs until the function times out, memory is exhausted, or Lambda terminates the execution environment.

3. **It should handle signals gracefully**. Lambda sends `SIGTERM` when it's about to shut down the execution environment. Your runtime can listen for this and clean up resources if needed, though Lambda will forcibly terminate the process if it doesn't exit quickly enough.

Let's look at a minimal example to make this concrete. Here's a simple shell script bootstrap that implements a custom runtime for a fictional language:

```bash
#!/bin/bash

# Trap SIGTERM for graceful shutdown
trap 'exit 0' SIGTERM

# Event loop
while true
do
  # Get the next invocation
  RESPONSE=$(curl -s -X GET "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/next")
  REQUEST_ID=$(echo $RESPONSE | jq -r '.requestId')
  PAYLOAD=$(echo $RESPONSE | jq -r '.body')

  # Invoke your handler (simplified)
  RESULT=$(echo "Handler executed with: $PAYLOAD" | jq -R -s '.')

  # Send the response back
  curl -s -X POST "http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/${REQUEST_ID}/response" \
    -d "$RESULT"
done
```

This script loops forever, pulling the next event, doing some processing (in reality, you'd invoke your actual handler code), and reporting the result. The beauty of this approach is that it's language-agnostic—you could invoke Python, Rust, or anything else from within this bootstrap.

### Building a Real Custom Runtime: Rust Example

Let's walk through a more realistic example: a custom runtime for Rust. Rust is a great candidate for a custom runtime because it's fast, memory-efficient, and not natively supported by Lambda (though AWS does provide it in some contexts now). This example will be minimal but functional.

First, here's a simple Rust handler function you might write:

```rust
pub fn handler(event: serde_json::Value) -> Result<serde_json::Value, String> {
    let name = event
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("World");
    
    Ok(serde_json::json!({
        "message": format!("Hello, {}!", name)
    }))
}
```

Now, let's build the runtime itself. Your runtime needs to:

1. Start an event loop
2. Call the next invocation endpoint
3. Parse the event
4. Invoke the handler
5. Serialize and send the response

Here's a minimal Rust runtime:

```rust
use serde_json::{json, Value};
use std::env;

mod handler;  // Contains the handler function from above

#[tokio::main]
async fn main() {
    let runtime_api = env::var("AWS_LAMBDA_RUNTIME_API")
        .expect("AWS_LAMBDA_RUNTIME_API not set");
    let client = reqwest::Client::new();

    loop {
        // Get next invocation
        let next_invocation_url = format!(
            "http://{}/2018-06-01/runtime/invocation/next",
            runtime_api
        );

        let invocation_response = client
            .get(&next_invocation_url)
            .send()
            .await
            .expect("Failed to get next invocation");

        let request_id = invocation_response
            .headers()
            .get("Lambda-Runtime-Aws-Request-Id")
            .and_then(|h| h.to_str().ok())
            .expect("Missing request ID")
            .to_string();

        let event: Value = invocation_response
            .json()
            .await
            .expect("Failed to parse event");

        // Call handler
        let result = match handler::handler(event) {
            Ok(response) => response,
            Err(e) => {
                let error_url = format!(
                    "http://{}/2018-06-01/runtime/invocation/{}/error",
                    runtime_api, request_id
                );
                let _ = client
                    .post(&error_url)
                    .json(&json!({
                        "errorMessage": e,
                        "errorType": "HandlerError"
                    }))
                    .send()
                    .await;
                continue;
            }
        };

        // Send response
        let response_url = format!(
            "http://{}/2018-06-01/runtime/invocation/{}/response",
            runtime_api, request_id
        );

        let _ = client
            .post(&response_url)
            .json(&result)
            .send()
            .await;
    }
}
```

To package this for Lambda, you'd:

1. Compile the Rust binary: `cargo build --release`
2. Create a bootstrap script that invokes it:

```bash
#!/bin/bash
exec /var/task/bootstrap_binary "$@"
```

3. Package it all into a ZIP file with the binary at the root alongside a `bootstrap` script, or use a container image (which we'll discuss next).

When Lambda invokes this function, it executes your `bootstrap` script, which starts your Rust runtime. The runtime enters its event loop and begins waiting for invocations. Each time an event arrives, it deserializes the JSON, calls your handler, and returns the result.

### Working with Lambda Base Images

While custom runtimes give you flexibility, there's an alternative that's often more practical: using container images. AWS provides base images for Lambda that already have the Runtime API client library included, significantly reducing your bootstrapping work.

When you build a container image for Lambda, you use one of AWS's base images as your `FROM` statement. These images include the Runtime API implementation and a default bootstrap that already knows how to invoke your handler. Your job is much simpler—you just add your code and specify an entry point.

For a Rust example using the AWS base image, your Dockerfile might look like:

```dockerfile
FROM public.ecr.aws/lambda/rust:latest

COPY target/release/your_runtime ${LAMBDA_RUNTIME_DIR}/bootstrap
COPY handler ${LAMBDA_TASK_ROOT}/

CMD [ "index.handler" ]
```

This approach saves you from implementing the full Runtime API client. AWS has done that work, and it's baked into the base image. You're essentially inheriting a battle-tested runtime and just customizing it for your language or use case.

### Understanding Initialization and Execution Phases

Lambda divides your function's lifetime into two phases: initialization and execution. Understanding this distinction is crucial for custom runtimes because it affects where errors are reported and how timeouts are calculated.

The **initialization phase** encompasses everything from when Lambda starts your execution environment until your handler code is invoked for the first time. This includes executing your bootstrap script and any setup code your runtime performs. If something fails during initialization—say, your bootstrap exits with an error—Lambda reports this as an initialization error. The entire initialization phase is subject to your function's timeout setting.

The **execution phase** begins after initialization succeeds and continues for each subsequent invocation. Each invocation also respects your timeout setting. If your handler doesn't complete within the timeout, Lambda terminates the execution environment.

For custom runtimes, this means your bootstrap should do minimal work upfront. Any expensive initialization—parsing configuration, loading libraries, connecting to databases—should be deferred until the first invocation if possible. This improves your cold start time and ensures your function is responsive.

### Error Handling and Reporting

Error handling in custom runtimes requires attention to detail. When something goes wrong, you need to report it via the appropriate endpoint with the right structure.

If an error occurs **during initialization** (i.e., your bootstrap fails), you should call the init error endpoint with a JSON body like:

```json
{
  "errorMessage": "Failed to load configuration",
  "errorType": "InitializationError"
}
```

If an error occurs **during handler invocation**, you call the invocation error endpoint with a similar structure:

```json
{
  "errorMessage": "Null pointer exception in user code",
  "errorType": "NullPointerException"
}
```

It's important to include both `errorMessage` and `errorType`. The `errorType` helps AWS categorize the error, and it appears in CloudWatch logs and error metrics. This information is valuable for debugging and monitoring.

One subtlety: if your custom runtime itself crashes (for instance, your runtime process dies unexpectedly), Lambda will detect this and report it as a platform error. Your runtime code should be robust enough to handle edge cases gracefully, even if that just means catching a broad exception and reporting it properly.

### Performance Considerations and Language Choice

The choice of language for your custom runtime affects both cold start time and per-invocation latency. Let's think through some trade-offs.

**Compiled languages** like Rust, Go, or C have excellent runtime performance and small memory footprint. Rust, in particular, is known for its zero-cost abstractions and memory safety without garbage collection. If you're building a custom runtime for performance-critical applications, a compiled language is often the right choice. The downside is that compilation takes time, and the build process is more complex.

**Interpreted languages** like Python or shell script are quicker to develop and iterate on, but they carry runtime overhead. If you're using a shell script as your bootstrap, you're also dealing with spawning child processes for each invocation, which adds latency. A shell-based runtime might be fine for demonstrating the concept or for low-frequency invocations, but it wouldn't scale well.

**JVM-based languages** (Java, Kotlin, Scala) have different characteristics. The JVM's startup time is relatively slow compared to a compiled binary, which hurts cold starts. However, the JVM's just-in-time compilation and optimization make subsequent invocations very fast. For functions that are invoked frequently, a JVM-based runtime can outperform interpreted alternatives.

In practice, the choice often comes down to where your code already lives. If you have a legacy PHP application and you want to run parts of it on Lambda, implementing a custom runtime for PHP makes sense. The performance overhead is worth the ability to reuse existing code.

### Container Images: When and Why

At this point, you might be wondering: should I use a custom runtime or a container image? The answer depends on your specific needs.

**Container images are better when:**
- You want to bundle dependencies that aren't easily portable (native libraries, compiled binaries)
- You prefer working with Docker and familiar containerization concepts
- You want to run pre-existing container images with minimal modification
- You don't want to implement the Runtime API yourself

**Custom runtimes are better when:**
- You're trying to optimize for the absolute smallest package size
- You have a very specific runtime requirement that AWS's base images don't address
- You're building a reusable runtime that others might use (like publishing a third-party Rust runtime)
- You want to deeply understand how Lambda works under the hood

For most practical purposes, container images provide a smoother developer experience. They're closer to how developers already think about containerization, and AWS's base images have been thoroughly tested and optimized. Custom runtimes are more of an advanced technique for specific scenarios.

### Practical Tips for Building Custom Runtimes

If you do decide to build a custom runtime, here are some hard-won insights that will help you avoid common pitfalls.

**Always test locally first.** AWS provides the Lambda Runtime Interface Emulator, a container image that you can run locally to test your custom runtime without deploying to AWS. This saves you from the frustration of discovering errors after uploading to Lambda. The emulator mimics the Lambda environment and lets you verify your bootstrap works correctly.

**Make your runtime stateless within invocations.** Each invocation is independent, so don't assume that variables or connections from one invocation will persist to the next in the way you might expect. If you maintain a database connection across invocations, ensure it's properly reset or reconnected for each invocation.

**Handle the full lifecycle of events.** Your runtime receives not just the event payload, but also metadata like the request ID, function ARN, and invocation type (synchronous vs. asynchronous). Some of this metadata is passed as headers; make sure you're extracting and passing it to your handler correctly.

**Log comprehensively.** Anything written to stdout or stderr is captured in CloudWatch logs. Make your runtime log important events—invocation starts, handler invocations, errors—so you have visibility into what's happening. Include the request ID in your logs so you can correlate log entries with specific invocations.

**Be defensive about timeouts.** Your runtime should respect the function's timeout and avoid doing infinite work. If your handler runs until the timeout expires, your runtime should cleanly report this as a timeout error rather than letting the entire execution environment hang.

### The Bigger Picture: Why Custom Runtimes Exist

Understanding custom runtimes gives you insight into Lambda's fundamental architecture. Lambda isn't magic—it's a container orchestration system with a well-defined protocol. By implementing that protocol yourself, you can run any language in any way you want.

This flexibility is powerful, but it's also why AWS recommends container images for most use cases. Containers are a more familiar abstraction to modern developers, and AWS's base images handle the protocol details for you. Custom runtimes are a lower-level mechanism—powerful and sometimes necessary, but with more responsibility on your shoulders.

The fact that custom runtimes exist also explains why Lambda feels so universal. You're not limited to the ten or so officially supported runtimes. Want to run COBOL for your mainframe integration project? Implement a custom runtime and you're good to go. Want to use a cutting-edge language that AWS hasn't officially blessed? Same answer. This flexibility is a major part of what makes Lambda compelling as a compute platform.

### Conclusion

Custom Lambda runtimes are a fascinating and powerful feature that rewards deep understanding of how Lambda works. The Runtime API is elegantly simple—a few HTTP endpoints that your code calls in sequence—yet implementing it correctly requires attention to detail around event handling, error reporting, and lifecycle management.

For most developers, container images will be the more pragmatic choice, offering the flexibility of custom runtimes with less boilerplate. But understanding how custom runtimes work gives you a powerful mental model of Lambda's architecture. You see that the officially supported runtimes are really just implementations of this same protocol, and that you can build your own if needed.

If you find yourself needing a language not officially supported by AWS, or if you want to deeply optimize how your handler is invoked, building a custom runtime is an achievable goal. Start by studying AWS's own runtime implementations on GitHub, test locally with the Lambda Runtime Interface Emulator, and iterate carefully. The reward is a profound understanding of how Lambda truly works—and often, code that's highly optimized for your specific use case.
