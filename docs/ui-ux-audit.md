# Office Service UI/UX audit

## Scope and design direction

This audit covers sign-in and first-time setup, employee ordering and history, staff fulfillment, administrator people and menu management, profile settings, and shared dialogs, controls, notices and navigation. The audit is based on the current source, including existing uncommitted work. It is not a screen-reader certification or a backend security audit.

The primary job is to get refreshments to the right desk without interrupting work. Employees need a fast selection and a clear order state. Staff need the next actionable request. Administrators need predictable editing and recovery.

The refresh uses an accent ladder inspired by the office tea break: porcelain `#f3f8f6`, white `#ffffff`, deep green ink `#183b34`, jade `#087e68`, mint `#dff2e9`, and muted green `#577168`. Locally bundled Hind Siliguri remains the single typeface so Bengali and English share an intentional, offline-capable system. Headlines use a restrained fluid scale; quantities use tabular figures.

A generic dashboard treatment was rejected: no invented metrics, gradient banners, decorative charts or repeated entrance effects. The distinctive element is line-drawn drinkware beside the real refreshments. All surrounding surfaces remain quiet.

## Visual hierarchy

- Previously, menu items, editing rows and page headings had little visual distinction. Menu rows now have separate surfaces, larger names and consistent category illustrations.
- The basket remains beside the menu on desktop and precedes it on mobile. This preserves immediate access to the order action rather than hiding it after the menu.
- Page descriptions explain each destination without adding an onboarding flow.
- Staff tabs retain real counts and active-state contrast; count backgrounds separate the count from its label.
- Order cards separate state and timestamp from the requested items. Desktop lists use available width without shrinking cards below a readable size.
- Account identity and role are grouped together instead of leaving a name disconnected from navigation.

## Visual style

- The former white-and-grey interface had a small green accent but little product character. Porcelain backgrounds and jade selections now connect the shared shell, refreshments and order action.
- The same locally loaded family covers both languages; no new remote font or runtime dependency is introduced.
- Rounded containers distinguish panels from controls. Resting cards have no decorative shadows; only dialogs float.
- Navigation icons use one stroke treatment. Refreshment illustrations are custom SVGs rather than emoji or remote images.
- A single short page entrance, state-color transitions, press feedback and dialog transitions communicate changes. The existing reduced-motion rule disables them.

## Accessibility

- Existing labels, native form controls, skip link, visible focus, required-field validation and error summaries are preserved.
- Buttons and quantity controls retain 44px minimum touch targets.
- New icons are decorative and hidden from assistive technology; text remains the accessible name.
- Navigation retains `aria-current`. Staff tabs retain the existing keyboard-enabled tab implementation.
- Dialog focus trapping, initial focus, Escape dismissal and focus return remain owned by the shared dialog implementation.
- Selection has both color and quantity evidence; order status remains written text rather than color alone.
- PIN input, paste behavior and four-digit validation are unchanged.
- Automated browser flows cover keyboard dialog operation and focus return. A manual screen-reader and high-zoom audit remains recommended; source inspection alone does not prove these behaviors.

## Navigation and responsive layout

- All existing destinations and role visibility remain unchanged: employee ordering/history/profile, staff queue, and administrator people/menu tools.
- Navigation now pairs short text with consistent outline icons. The account area shows the user's actual role.
- The sidebar folds to the existing mobile menu instead of becoming an unlabeled icon rail.
- At tablet widths, the existing compact header is retained. At narrow widths, ordering becomes one column and cards adapt to the available width.
- Dynamic viewport heights keep navigation and dialogs within mobile browser chrome. Safe-area padding protects the bottom of the content.
- The desktop navigation can scroll when content or text enlargement exceeds its viewport height.

## Usability and feedback

- The existing draft persistence, same-order retry after an uncertain response, locked attempted payload and unavailable-item recovery remain intact.
- Offline restrictions and live/stale connection messaging remain intact.
- Order confirmations preserve their programmatic focus and scroll behavior. A check mark adds visual confirmation without replacing the existing live announcement.
- Consequential exception actions still require reasons in dialogs. Routine accept/deliver actions remain direct to avoid adding friction to the staff queue.
- Existing loading, empty, validation, error and retry messages remain visible. No simulated data or fake success state has been introduced.

## Forms and onboarding

- Field labels now use stronger ink and weight. Panel spacing and full-width sign-in actions establish a clearer reading order.
- Setup and sign-in remain distinct, with existing administrator-password and employee/staff-PIN paths preserved.
- Profile sections retain their actual account, credential and device-notification controls.
- The first-time local certificate instructions remain available; the redesign does not conceal required setup guidance.

## Remaining priorities

1. **Credential policy:** the existing temporary PIN default is `0000`. Changing provisioning policy requires a separate authentication decision, not a visual restyle. The forced first-sign-in change and current warnings remain intact.
2. **Long menus:** every active refreshment is currently listed. Category grouping or search should be introduced if real menu size makes scanning difficult; no unnecessary filter is added for a small office menu.
3. **Accessibility follow-up:** manually test a screen reader, browser text enlargement and forced colors on the deployment's supported devices.
4. **Authorization:** client navigation is not a security boundary. This audit preserves role-specific presentation and makes no new claim about server authorization.
