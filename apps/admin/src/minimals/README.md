# Minimals source components

Copied from the user's existing Minimals MUI 5 source at:
`/Users/edi/Documents/ChatGPT/console payment/frontend/src`

Original modules preserved: Iconify, Label (including styles/types), FormProvider,
RHFTextField, useBoolean, BackgroundShape, SeoIllustration,
PageNotFoundIllustration, ForbiddenIllustration, SeverErrorIllustration.
Illustration character assets are copied into public/assets/illustrations/characters.
Only image URLs were adapted to Vite BASE_URL.

Integration adapters live under src/website/auth. AuthLayout follows Minimals
AuthClassicLayout composition, with local brand, theme, routing and illustration.
Login and registration follow Minimals modern auth view form composition.
MUI Button replaces LoadingButton to match installed MUI dependencies.

Official references:
- https://minimals.cc/
- https://docs.minimals.cc/components/
- https://docs.minimals.cc/quick-start/

No original auth demo submit/logging implementation is used. Existing login uses
AuthContext. Registration and recovery are explicitly UI previews: validation
only, no account creation, mail delivery, password change or client persistence.
Original template license remains applicable; these files are not relicensed.
