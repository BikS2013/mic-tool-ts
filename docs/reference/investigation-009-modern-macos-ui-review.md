# Investigation 009: Modern macOS UI Review

## Executive Summary

The Plan 008 architecture remains appropriate, but the visual mockup should be revised. The current visual uses a decorative gradient desktop and many nested frosted panels, which reads more like older web glassmorphism than recent macOS. A more modern macOS direction should use Liquid Glass-like treatment for controls, navigation, and toolbar layers, while keeping transcript content calmer and more legible.

## Context

- Project: `mic-tool-ts`.
- Current proposed UI plan: `docs/design/plan-008-electron-ui-command.md`.
- Current proposed visual: `docs/design/plan-008-electron-ui-command-visual.html`.
- Requested change: review the proposed UI design and try a more modern macOS aesthetic.

## Research Questions

1. Which current Apple design guidance affects this mockup?
2. Which Electron capabilities still constrain the implementation?
3. What visual changes would make the concept feel closer to recent macOS without overpromising native parity?

## Sources And Access Date

Access date: 2026-05-16.

- Apple Human Interface Guidelines, "Materials": https://developer.apple.com/design/human-interface-guidelines/materials
- Apple Human Interface Guidelines, "Layout": https://developer.apple.com/design/human-interface-guidelines/layout
- Apple Human Interface Guidelines, "Sidebars": https://developer.apple.com/design/human-interface-guidelines/sidebars
- Apple Human Interface Guidelines, "Toolbars": https://developer.apple.com/design/human-interface-guidelines/toolbars
- Apple Human Interface Guidelines, "Color": https://developer.apple.com/design/human-interface-guidelines/color
- Electron, "Window Customization": https://www.electronjs.org/docs/latest/tutorial/window-customization
- Electron, "Custom Title Bar": https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
- Electron, "BrowserWindow": https://www.electronjs.org/docs/latest/api/browser-window

## Key Findings

- Apple guidance distinguishes Liquid Glass from standard materials. Liquid Glass-like treatment is best used for controls and navigation above content, while standard materials help separate content-layer regions.
- Apple layout guidance emphasizes clear hierarchy between content and control layers. For `mic-tool-ts ui`, the transcript should be the primary content plane, not another glass card inside multiple glass panels.
- Apple sidebar guidance describes sidebars floating above content in the Liquid Glass layer. This supports keeping the sidebar translucent, but argues against putting every inspector panel and transcript message on the same glass treatment.
- Electron can approximate a macOS window with hidden or hidden-inset title bars, native traffic lights, vibrancy, transparent backgrounds, and `ready-to-show` handling. It still cannot provide exact native Liquid Glass behavior in web content.

## Existing Mockup Review

The current mockup has several good foundations:

- It uses a native-feeling three-region app structure: sidebar, transcript, and inspector.
- It keeps the first screen as the product experience rather than a landing page.
- It represents transcript partials, finals, processed output, credentials, protocol state, and UI-mode rendering.
- It includes dark mode and reduced-motion handling.

Issues to fix in the next visual direction:

- The background and window treatment are too decorative. The fake desktop gradient behind the app makes the concept feel like a marketing mock rather than an installed macOS utility.
- Glass is overused. The window, toolbar, sidebar, messages, live strip, inspector, panels, pills, and footer all use translucent surfaces. This flattens hierarchy and reduces the "content under controls" feel.
- The mockup draws traffic lights in HTML. For production, Electron should rely on native macOS traffic lights with a reserved titlebar drag region.
- The right inspector is a stack of small cards, which reads closer to a SaaS dashboard than macOS settings or inspector UI.
- Several labels explain implementation details directly in the UI, such as console suppression and UI event sink state. These belong in logs or documentation, not the normal monitor surface.
- The Settings representation is mostly read-only value rows. A production UI should use native-feeling controls: pop-up buttons, segmented controls, switches, token fields, text fields, and explicit credential sheets.
- Reduced transparency is not represented. The design should provide a high-opacity path for users who disable transparency.

## Revised Direction

Use a calmer desktop utility layout:

- Native titlebar area with reserved traffic-light space and a draggable toolbar.
- A translucent sidebar/control rail floating over the content edge.
- A transcript content plane with standard material and high contrast.
- A compact top toolbar with session summary, provider, model, language, and status.
- A bottom capture bar for audio level, live partial text, and start/stop action.
- A contextual inspector that feels like a macOS form/list surface, not nested cards.
- Status and diagnostics as compact rows or a logs view, not explanatory hero copy.

## Derived Design Decisions

- Keep the existing Plan 008 architecture unchanged.
- Treat `docs/design/plan-009-modern-macos-ui-visual.html` as the preferred visual direction for future UI implementation.
- Keep `docs/design/plan-008-electron-ui-command-visual.html` as historical context.
- In production Electron, use native macOS traffic lights through `titleBarStyle` rather than drawing red/yellow/green dots in renderer HTML.
- Use CSS `backdrop-filter` sparingly in the renderer because Electron's macOS vibrancy already contributes system-level translucency.
- Add reduced-transparency CSS that increases opacity, removes blur-heavy layering, and preserves contrast.

## Original Request

> Can you review the proposed UI design to try something more modern and closer to the recent macOS aesthetic?


---
> **Historical note:** project renamed from `mic-tool-ts` to `untype` on 2026-05-23. References to `mic-tool-ts` in this document are preserved verbatim for historical accuracy.
