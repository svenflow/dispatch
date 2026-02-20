#!/usr/bin/env swift

import Foundation
import Vision
import CoreImage
import AppKit

// Parse arguments
guard CommandLine.arguments.count >= 3 else {
    print("Usage: vision_segment.swift <input_image> <output_prefix>")
    exit(1)
}

let inputPath = CommandLine.arguments[1]
let outputPrefix = CommandLine.arguments[2]

// Load image
guard let nsImage = NSImage(contentsOfFile: inputPath) else {
    print("Failed to load image: \(inputPath)")
    exit(1)
}

// Convert to CGImage
guard let tiffData = nsImage.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiffData),
      let cgImage = bitmap.cgImage else {
    print("Failed to convert to CGImage")
    exit(1)
}

let width = cgImage.width
let height = cgImage.height
print("Image size: \(width)x\(height)")

// Create person segmentation request
let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = .accurate
request.outputPixelFormat = kCVPixelFormatType_OneComponent8

// Create handler and perform
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

do {
    try handler.perform([request])
} catch {
    print("Failed to perform request: \(error)")
    exit(1)
}

// Get results
guard let observation = request.results?.first else {
    print("No person detected")
    exit(1)
}

let maskBuffer = observation.pixelBuffer

// Get mask dimensions
let maskWidth = CVPixelBufferGetWidth(maskBuffer)
let maskHeight = CVPixelBufferGetHeight(maskBuffer)
print("Mask size: \(maskWidth)x\(maskHeight)")

// Lock buffer
CVPixelBufferLockBaseAddress(maskBuffer, .readOnly)
defer { CVPixelBufferUnlockBaseAddress(maskBuffer, .readOnly) }

guard let baseAddress = CVPixelBufferGetBaseAddress(maskBuffer) else {
    print("Failed to get buffer base address")
    exit(1)
}

let bytesPerRow = CVPixelBufferGetBytesPerRow(maskBuffer)

// Create grayscale image from mask
let colorSpace = CGColorSpaceCreateDeviceGray()
guard let context = CGContext(
    data: baseAddress,
    width: maskWidth,
    height: maskHeight,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.none.rawValue
) else {
    print("Failed to create context")
    exit(1)
}

guard let maskCGImage = context.makeImage() else {
    print("Failed to create mask image")
    exit(1)
}

// Scale mask to original image size
let scaledContext = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.none.rawValue
)!

scaledContext.interpolationQuality = .high
scaledContext.draw(maskCGImage, in: CGRect(x: 0, y: 0, width: width, height: height))

guard let scaledMask = scaledContext.makeImage() else {
    print("Failed to scale mask")
    exit(1)
}

// Save mask
let maskRep = NSBitmapImageRep(cgImage: scaledMask)
guard let maskPNG = maskRep.representation(using: .png, properties: [:]) else {
    print("Failed to create PNG")
    exit(1)
}

let maskPath = "\(outputPrefix)_mask.png"
try! maskPNG.write(to: URL(fileURLWithPath: maskPath))
print("Saved mask: \(maskPath)")

// Create overlay (original with green tint on persons)
let rgbColorSpace = CGColorSpaceCreateDeviceRGB()
guard let overlayContext = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: rgbColorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    print("Failed to create overlay context")
    exit(1)
}

// Draw original image
overlayContext.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

// Get pixel data
guard let pixelData = overlayContext.data else {
    print("Failed to get pixel data")
    exit(1)
}

// Get mask pixel data
guard let maskData = scaledContext.data else {
    print("Failed to get mask data")
    exit(1)
}

let pixels = pixelData.bindMemory(to: UInt8.self, capacity: width * height * 4)
let maskPixels = maskData.bindMemory(to: UInt8.self, capacity: width * height)

// Apply green tint where mask > 128
for y in 0..<height {
    for x in 0..<width {
        let maskIdx = y * width + x
        let pixelIdx = maskIdx * 4

        if maskPixels[maskIdx] > 128 {
            // Add green tint
            let g = min(255, Int(pixels[pixelIdx + 1]) + 60)
            pixels[pixelIdx + 1] = UInt8(g)
        }
    }
}

guard let overlayImage = overlayContext.makeImage() else {
    print("Failed to create overlay image")
    exit(1)
}

let overlayRep = NSBitmapImageRep(cgImage: overlayImage)
guard let overlayPNG = overlayRep.representation(using: .png, properties: [:]) else {
    print("Failed to create overlay PNG")
    exit(1)
}

let overlayPath = "\(outputPrefix)_overlay.png"
try! overlayPNG.write(to: URL(fileURLWithPath: overlayPath))
print("Saved overlay: \(overlayPath)")

// Create cutout (person with transparent background)
guard let cutoutContext = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: rgbColorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    print("Failed to create cutout context")
    exit(1)
}

cutoutContext.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

guard let cutoutData = cutoutContext.data else {
    print("Failed to get cutout data")
    exit(1)
}

let cutoutPixels = cutoutData.bindMemory(to: UInt8.self, capacity: width * height * 4)

// Set alpha based on mask
for y in 0..<height {
    for x in 0..<width {
        let maskIdx = y * width + x
        let pixelIdx = maskIdx * 4
        cutoutPixels[pixelIdx + 3] = maskPixels[maskIdx]  // Alpha = mask value
    }
}

guard let cutoutImage = cutoutContext.makeImage() else {
    print("Failed to create cutout image")
    exit(1)
}

let cutoutRep = NSBitmapImageRep(cgImage: cutoutImage)
guard let cutoutPNG = cutoutRep.representation(using: .png, properties: [:]) else {
    print("Failed to create cutout PNG")
    exit(1)
}

let cutoutPath = "\(outputPrefix)_cutout.png"
try! cutoutPNG.write(to: URL(fileURLWithPath: cutoutPath))
print("Saved cutout: \(cutoutPath)")

print("Done!")
