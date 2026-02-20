#version 330
uniform vec2 u_resolution;
uniform float u_time;
out vec4 fragColor;

// Template shader - animated gradient
// Modify this to create your own shader

void main() {
    // Normalize coordinates to 0-1
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;

    // Center coordinates (-0.5 to 0.5)
    vec2 centered = uv - 0.5;

    // Aspect-corrected coordinates
    vec2 aspect = centered * vec2(u_resolution.x / u_resolution.y, 1.0);

    // Example: animated radial gradient
    float dist = length(aspect);
    float angle = atan(aspect.y, aspect.x);

    // Animate with time
    float wave = sin(dist * 10.0 - u_time * 2.0) * 0.5 + 0.5;
    float spiral = sin(angle * 5.0 + dist * 10.0 - u_time) * 0.5 + 0.5;

    // Color
    vec3 color = vec3(wave, spiral, sin(u_time) * 0.5 + 0.5);

    fragColor = vec4(color, 1.0);
}
