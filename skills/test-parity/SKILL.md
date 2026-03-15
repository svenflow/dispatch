---
name: test-parity
description: Ensure JS implementations match Python library outputs exactly. Use when writing tests for pydatajs packages (torchjs, numpyjs, scikitlearnjs).
---

# Test Parity Skill

This skill ensures JavaScript implementations in pydatajs produce **identical numerical outputs** to their Python equivalents.

## Workflow

When writing tests for JS ops that mirror Python libraries:

1. **Run the Python code** with specific inputs
2. **Capture exact numerical output** (copy-paste the values)
3. **Hardcode those values** in the JS test as expected results
4. **Test JS implementation** against those values

## Example: Testing `relu`

### Step 1: Run Python to get expected values

```python
import torch
import torch.nn.functional as F

x = torch.tensor([-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0])
print('input:', x.tolist())
print('output:', F.relu(x).tolist())
```

Output:
```
input: [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0]
output: [0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 2.0]
```

### Step 2: Create JS test with exact values

```typescript
import { describe, it, expect } from 'vitest';
import { nn, tensor } from 'torchjs';

describe('relu', () => {
  it('matches PyTorch output exactly', () => {
    // Same input as Python test
    const input = tensor([-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0], [7]);

    // Expected values from PyTorch
    const expected = [0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 2.0];

    const result = nn.relu(input);

    // Compare each value
    for (let i = 0; i < expected.length; i++) {
      expect(result.data[i]).toBeCloseTo(expected[i], 6);
    }
  });
});
```

## Package Mappings

| JS Package | Python Library | Operations |
|------------|---------------|------------|
| `torchjs` | `torch.nn.functional` | conv2d, relu, sigmoid, softmax, pool, batch_norm |
| `numpyjs` | `numpy` | matmul, reshape, sin, cos, sum, mean, etc. |
| `scikitlearnjs` | `sklearn` | StandardScaler, MLPClassifier, KMeans, metrics |

## Running Python for Test Values

Use `uv run python3 -c "..."` to quickly get expected values:

```bash
uv run python3 -c "
import torch
import torch.nn.functional as F
# ... your test code
"
```

## Tolerance

Use `toBeCloseTo(expected, 6)` for float comparisons (6 decimal places).

For f32 vs f64 differences, use `toBeCloseTo(expected, 5)` (5 decimal places).

## Common Test Cases

### Activation Functions
- Positive, negative, and zero inputs
- Edge cases: very large, very small values
- NaN handling

### Convolutions
- Simple 3x3 kernel, no padding
- With padding
- With stride > 1
- Multi-channel, batched

### Pooling
- 2x2 kernel, stride 2 (common case)
- With padding
- Global pooling

### Normalization
- Standard input ranges
- With learned gamma/beta

## CLAUDE.md Addition

Add this to package CLAUDE.md files:

```markdown
## Testing Methodology

Tests verify JS outputs match Python library outputs exactly:

1. Run operation in Python (torch/numpy/sklearn)
2. Copy exact numerical output
3. Hardcode in JS test as expected values
4. Test JS implementation against those values

Use `toBeCloseTo(expected, 6)` for float comparison.
```
