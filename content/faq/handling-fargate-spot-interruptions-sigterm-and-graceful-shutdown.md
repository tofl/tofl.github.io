---
title: "Handling Fargate Spot Interruptions: SIGTERM and Graceful Shutdown"
---

## Handling Fargate Spot Interruptions: SIGTERM and Graceful Shutdown

Fargate Spot offers tremendous cost savings—up to 70% off on-demand pricing—but it comes with a fundamental trade-off: your tasks can be interrupted with minimal notice. The good news? AWS gives you a two-minute warning before eviction, and if you know how to listen for it, you can save work, drain connections, and shut down gracefully rather than crashing mid-operation. Understanding SIGTERM, the Fargate interruption lifecycle, and how to implement proper signal handling is essential for anyone running production batch jobs, CI/CD pipelines, or long-running services on Spot instances.

This article walks you through the mechanics of Fargate Spot interruptions, shows you exactly how to catch and handle shutdown signals in the languages you're likely using, and demonstrates practical patterns for protecting your workloads from data loss and corruption.

### Understanding the Fargate Spot Interruption Timeline

Before diving into code, let's establish what actually happens when AWS needs to reclaim a Spot instance. The sequence is deterministic and predictable, which makes it possible to build reliable systems around it.

When AWS determines that your Fargate task needs to be interrupted, the process unfolds like this: first, a Two-Minute Warning is generated and made available through the Fargate Task Metadata service. At the same time, AWS sends a `SIGTERM` signal to the main process running inside your container. You have roughly 120 seconds (the exact duration depends on your `stopTimeout` configuration, which we'll discuss shortly) to gracefully shut down your application. If your process doesn't exit within that window, Fargate sends `SIGKILL`, which immediately terminates the process—there's no way to catch it, no chance to save state.

This two-minute window is your lifeline. It's enough time to finish a database transaction, flush buffers, close open files, drain a queue, or checkpoint your work so you can resume from where you left off. The key is anticipating the signal and acting on it immediately.

### How Fargate Sends Signals to Containers

Fargate sends signals to the process running in your container just like any Linux system would. When you specify an entrypoint in your task definition, that becomes the main process (PID 1) inside the container, and it receives these signals directly.

Here's the crucial detail: the signal is sent to PID 1. If your entrypoint is a shell script or a wrapper, and that script doesn't properly pass signals to child processes, your actual application may never receive the `SIGTERM`. This is a common source of frustration. For example, if you start a Python application like `python app.py` directly as your entrypoint, the Python process is PID 1 and receives signals. But if you wrap it in a shell script that doesn't use `exec`, the shell is PID 1 and might swallow the signal.

The best practice is to either run your application directly as the entrypoint, or use `exec` in a shell script to replace the shell process with your application. For instance:

```bash
#!/bin/bash
exec python /app/main.py
```

This ensures your application becomes PID 1 and receives signals directly. Without the `exec` keyword, the shell remains PID 1, and signals don't reach your Python process.

### Configuring stopTimeout in Your Task Definition

The `stopTimeout` parameter in your Fargate task definition controls how long Fargate waits after sending `SIGTERM` before sending `SIGKILL`. This is your grace period.

On Fargate, the maximum `stopTimeout` is 120 seconds. If you don't specify it, the default is 30 seconds, which may not be enough for slower shutdown procedures. If you're running a batch job that needs to checkpoint data or a service that must drain connections, you'll want to increase this.

Setting `stopTimeout` in your task definition (using the AWS Console or infrastructure-as-code tools like CloudFormation, Terraform, or CDK) looks like this in JSON:

```json
{
  "family": "my-task",
  "containerDefinitions": [
    {
      "name": "my-container",
      "image": "my-image:latest",
      "stopTimeout": 90
    }
  ]
}
```

Or in Terraform:

```hcl
resource "aws_ecs_task_definition" "my_task" {
  family                   = "my-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([
    {
      name      = "my-container"
      image     = "my-image:latest"
      stopTimeout = 90
    }
  ])
}
```

Choose a `stopTimeout` value that gives your application enough time to clean up without being wastefully long. For most batch jobs, 60–90 seconds is reasonable. For services handling long-running requests, consider what your slowest graceful shutdown might take.

### Catching SIGTERM in Node.js

Node.js applications are particularly well-suited to handling signals because the runtime makes it straightforward. Here's a complete example of a simple Node.js application that listens for `SIGTERM`, closes connections, and exits cleanly:

```javascript
const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Hello World');
});

server.listen(3000, () => {
  console.log('Server running on port 3000');
});

// Track active connections
let isShuttingDown = false;
const activeRequests = new Set();

server.on('connection', (conn) => {
  activeRequests.add(conn);
  conn.on('close', () => {
    activeRequests.delete(conn);
  });
});

// Handle SIGTERM
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, starting graceful shutdown');
  isShuttingDown = true;

  // Stop accepting new connections
  server.close(() => {
    console.log('Server closed');
  });

  // Close active connections gracefully
  for (const conn of activeRequests) {
    conn.end();
  }

  // Perform cleanup tasks (database writes, file flushes, etc.)
  try {
    await performCleanup();
    console.log('Cleanup complete');
  } catch (err) {
    console.error('Cleanup failed:', err);
  }

  // Exit the process
  process.exit(0);
});

// Simulate cleanup work
async function performCleanup() {
  // Flush buffers, close database connections, etc.
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log('Flushing state to disk');
      fs.writeFileSync('/tmp/state.json', JSON.stringify({ shutdown: true }));
      resolve();
    }, 100);
  });
}
```

The key points here are: listen for `SIGTERM` with `process.on('SIGTERM', ...)`, stop accepting new work, close existing connections gracefully, perform necessary cleanup, and then call `process.exit(0)`. By exiting cleanly, you signal to Fargate that you're done and prevent the `SIGKILL` from firing.

For Express or other frameworks, the pattern is the same—close the server, drain active requests, and clean up.

### Catching SIGTERM in Python

Python's signal handling requires a bit more care, but it's equally achievable. Here's a practical example using Python's `signal` module:

```python
import signal
import sys
import json
import time
from flask import Flask

app = Flask(__name__)
shutdown_event = False

@app.route('/')
def hello():
    return 'Hello World'

def signal_handler(signum, frame):
    global shutdown_event
    print('SIGTERM received, starting graceful shutdown')
    shutdown_event = True
    # Perform cleanup
    perform_cleanup()
    print('Cleanup complete, exiting')
    sys.exit(0)

def perform_cleanup():
    """Checkpoint work, flush buffers, close connections."""
    print('Flushing state to disk')
    with open('/tmp/state.json', 'w') as f:
        json.dump({'shutdown': True}, f)
    time.sleep(0.1)  # Simulate I/O

if __name__ == '__main__':
    # Register signal handler
    signal.signal(signal.SIGTERM, signal_handler)
    
    print('Starting Flask server')
    app.run(host='0.0.0.0', port=3000, threaded=True)
```

The `signal.signal()` call registers your handler function to be invoked when `SIGTERM` is received. The handler receives two arguments: the signal number and the current stack frame. From there, you can perform cleanup and exit.

One important caveat with Python: if you're using a framework like Flask with `threaded=True` or Gunicorn with multiple workers, signal handling becomes more complex. In production, consider using Gunicorn with the `graceful_timeout` and `timeout` settings configured, which handles signals for you and manages worker shutdown:

```bash
gunicorn --workers 4 --graceful-timeout 90 --timeout 120 app:app
```

This tells Gunicorn to wait 90 seconds for workers to finish their current requests before forcefully terminating them.

### Catching SIGTERM in Go

Go's signal handling is clean and idiomatic. Here's an example using the `os/signal` package:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "Hello World")
	})

	server := &http.Server{
		Addr:    ":3000",
		Handler: http.DefaultServeMux,
	}

	// Start server in a goroutine
	go func() {
		log.Println("Starting server on :3000")
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGTERM, syscall.SIGINT)

	sig := <-sigChan
	log.Printf("Received signal: %v", sig)

	// Perform cleanup
	if err := performCleanup(); err != nil {
		log.Printf("Cleanup error: %v", err)
	}

	// Gracefully shut down the server with a timeout
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("Server shutdown error: %v", err)
	}

	log.Println("Server stopped")
	os.Exit(0)
}

func performCleanup() error {
	log.Println("Flushing state to disk")
	// Simulate cleanup work
	data := map[string]bool{"shutdown": true}
	// Write to file, flush database connections, etc.
	return nil
}
```

Go's `http.Server.Shutdown()` method is particularly elegant—it stops accepting new connections and waits for existing ones to finish with a timeout. If they don't finish in time, it returns an error, but the process can still exit cleanly.

### Catching SIGTERM in Java

Java applications, especially those using Spring Boot, can handle signals with signal handlers or by using libraries that abstract away the complexity. Here's an example using Java's `Runtime.addShutdownHook()`:

```java
import java.io.*;

public class Application {
    public static void main(String[] args) {
        System.out.println("Starting application");

        // Register shutdown hook to handle SIGTERM
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("SIGTERM received, starting graceful shutdown");
            performCleanup();
            System.out.println("Cleanup complete");
        }));

        // Start your application logic
        startServer();
    }

    private static void startServer() {
        // Your application code here
        try {
            Thread.sleep(Long.MAX_VALUE);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void performCleanup() {
        try {
            System.out.println("Flushing state to disk");
            // Flush buffers, close database connections, etc.
            try (FileWriter fw = new FileWriter("/tmp/state.json")) {
                fw.write("{\"shutdown\": true}");
            }
        } catch (IOException e) {
            System.err.println("Cleanup error: " + e.getMessage());
        }
    }
}
```

Shutdown hooks are executed when the JVM is terminating, whether due to `System.exit()` or a signal like `SIGTERM`. This gives your application a chance to clean up resources.

For Spring Boot applications, you can also implement `DisposableBean` or use `@PreDestroy` annotations to hook into the application lifecycle:

```java
import org.springframework.stereotype.Component;
import jakarta.annotation.PreDestroy;

@Component
public class GracefulShutdownComponent {
    
    @PreDestroy
    public void shutdown() {
        System.out.println("SIGTERM received, performing cleanup");
        performCleanup();
    }

    private void performCleanup() {
        // Close connections, flush buffers, etc.
    }
}
```

Spring Boot automatically invokes these methods when the application context is closing.

### Checkpointing Patterns for Batch Jobs

Batch jobs are particularly vulnerable to interruption because they often process large datasets, and losing progress means redoing work. Checkpointing—saving your progress at regular intervals—is the antidote.

The basic pattern is straightforward: divide your work into chunks, and after processing each chunk, save your position. When the job restarts, read the checkpoint and resume from there.

Here's a conceptual example in Python:

```python
import json
import signal
import sys
import time

class BatchProcessor:
    def __init__(self, checkpoint_file='/tmp/checkpoint.json'):
        self.checkpoint_file = checkpoint_file
        self.processed_items = 0
        self.is_shutting_down = False
        
        # Register signal handler
        signal.signal(signal.SIGTERM, self.signal_handler)
    
    def signal_handler(self, signum, frame):
        print('SIGTERM received, checkpointing and exiting')
        self.is_shutting_down = True
        self.save_checkpoint()
        sys.exit(0)
    
    def load_checkpoint(self):
        """Load the last known progress."""
        try:
            with open(self.checkpoint_file, 'r') as f:
                data = json.load(f)
                self.processed_items = data.get('processed_items', 0)
                print(f'Resuming from item {self.processed_items}')
        except FileNotFoundError:
            print('No checkpoint found, starting from beginning')
    
    def save_checkpoint(self):
        """Save current progress."""
        with open(self.checkpoint_file, 'w') as f:
            json.dump({'processed_items': self.processed_items}, f)
        print(f'Checkpoint saved: {self.processed_items} items processed')
    
    def process_items(self, items):
        """Process a list of items, checkpointing after each batch."""
        self.load_checkpoint()
        
        for i, item in enumerate(items[self.processed_items:], start=self.processed_items):
            if self.is_shutting_down:
                break
            
            # Process the item
            print(f'Processing item {i}: {item}')
            time.sleep(0.5)  # Simulate work
            
            self.processed_items = i + 1
            
            # Checkpoint every 10 items
            if self.processed_items % 10 == 0:
                self.save_checkpoint()
        
        # Final checkpoint
        if not self.is_shutting_down:
            self.save_checkpoint()
            print('All items processed')

if __name__ == '__main__':
    items = [f'item_{i}' for i in range(100)]
    processor = BatchProcessor()
    processor.process_items(items)
```

When this job is interrupted, it saves its checkpoint. On restart, it loads the checkpoint and picks up where it left off. The frequency of checkpointing is a trade-off: more frequent checkpoints mean less lost work but more I/O overhead; less frequent means faster processing but more potential loss.

For distributed batch systems, you might store checkpoints in a database or S3 for durability and to support resumption across different tasks. The principle remains the same: persist progress at regular intervals and resume from the latest checkpoint on startup.

### Monitoring the Task Metadata Service for Interruption Warnings

In addition to catching `SIGTERM`, you can proactively monitor the Fargate Task Metadata service for interruption warnings. This allows you to start graceful shutdown before the signal arrives, which can be useful if your shutdown process is slow or if you want to log additional diagnostics.

The metadata service runs at `http://169.254.170.2/v4/metadata`. For Spot interruption notifications, query the `spot/instance-action` endpoint:

```bash
curl http://169.254.170.2/v4/metadata/spot/instance-action
```

If an interruption is scheduled, this returns a JSON response with the action and approximate time:

```json
{
  "action": "terminate",
  "time": "2024-01-15T14:32:45Z"
}
```

Here's a Go example that polls this endpoint in a background goroutine:

```go
package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"time"
)

type SpotAction struct {
	Action string `json:"action"`
	Time   string `json:"time"`
}

func monitorSpotInterruption() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	client := &http.Client{Timeout: 2 * time.Second}

	for range ticker.C {
		resp, err := client.Get("http://169.254.170.2/v4/metadata/spot/instance-action")
		if err != nil {
			log.Printf("Spot metadata check failed: %v", err)
			continue
		}

		if resp.StatusCode == 404 {
			// No interruption scheduled
			resp.Body.Close()
			continue
		}

		if resp.StatusCode == 200 {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()

			var action SpotAction
			if err := json.Unmarshal(body, &action); err != nil {
				log.Printf("Failed to parse spot action: %v", err)
				continue
			}

			log.Printf("Spot interruption detected: %s at %s", action.Action, action.Time)
			// Trigger graceful shutdown
			// (signal your shutdown handler or channel here)
		}
	}
}
```

This polling approach is optional—`SIGTERM` alone is sufficient to handle interruptions—but it can provide valuable observability and allow you to start cleanup proactively.

### Best Practices and Common Pitfalls

Building resilient Fargate Spot applications comes down to a few core practices. First, always set an appropriate `stopTimeout` for your workload. Thirty seconds is often too short; aim for at least 60 seconds unless you're running very lightweight services. Document your shutdown sequence so that future changes don't break graceful shutdown by accident.

Second, test your signal handling. Don't rely on the assumption that it works in production. Simulate interruptions locally or in staging by sending `SIGTERM` to your running container and verifying that cleanup actually happens. You can test this by running your container locally and using `docker stop` (which sends `SIGTERM`) or by using tools like `kill -TERM <pid>`.

Third, be careful with child processes and signal propagation. If your entrypoint is a shell script or a wrapper, use `exec` to replace the shell with your application so signals reach the right process. If you intentionally spawn child processes (worker threads, subprocesses, etc.), ensure your application correctly forwards signals to them or waits for them to finish.

Fourth, avoid logging to stdout/stderr as your only form of persistence. In the event of an interruption, those logs may be lost. For critical state, write to persistent storage—a file on EBS, a database, or object storage.

Finally, distinguish between graceful shutdown (where you clean up and exit with code 0) and crashes (where you exit with a non-zero code or don't exit at all). Fargate and ECS track exit codes and will restart tasks that crash, which can mask signal-handling issues. Always exit with code 0 if your shutdown was intentional.

### Conclusion

Fargate Spot interruptions are not a disaster waiting to happen—they're a manageable reality if you build your applications to expect them. The two-minute warning period and the SIGTERM signal give you enough time to shut down gracefully, save state, and prevent data loss.

Implementing signal handling in your application is straightforward across Node.js, Python, Go, and Java. Choose a stopTimeout that matches your shutdown needs, test your implementation, and trust that your application will handle interruptions cleanly. For batch workloads, add checkpointing to make resumption seamless.

By combining proper signal handling, adequate shutdown timeouts, and state checkpointing, you can harness the cost benefits of Fargate Spot without sacrificing reliability. Your batch jobs will complete reliably, your CI/CD pipelines won't fail due to spot interruptions, and your team will sleep better knowing that your infrastructure gracefully handles the inevitable.
