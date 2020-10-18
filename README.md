# opentelemetry-plugin-better-sqlite3

OpenTelemetry better-sqlite3 automatic instrumentation package

## Usage

```typescript
import opentelemetry from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/node';

// Add span processors
import { SimpleSpanProcessor } from '@opentelemetry/tracing';

// Whichever importer you like
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';

const provider = new NodeTracerProvider({
    plugins: {
        'better-sqlite3': {
            path: 'opentelemetry-plugin-better-sqlite3',
        },
        // Add other plugins as needed
        http: {},
        https: {},
    },
});

// Set up exporters and span processors
const zipkinExporter = new ZipkinExporter({
    url: 'http://127.0.0.1:9411/api/v2/spans',
    serviceName: 'sample-service',
});

provider.addSpanProcessor(new SimpleSpanProcessor(zipkinExporter));

provider.register();
```
