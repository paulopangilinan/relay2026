# Assets — How to Update Images

Replace any file below to update the registration page.
Keep the exact same filename — the HTML references these paths directly.

## Folder Structure

assets/
├── images/
│   ├── hero.jpg                        ← Banner at the top of the registration form
│   ├── hero-email.jpg                  ← Banner used inside all email templates (provide this file!)
│   ├── admin-logo.jpg                  ← Logo shown in admin dashboard header (provide this file!)
│   ├── speakers/
│   │   ├── dave-taylor.png             ← Speaker photo
│   │   ├── riley-spring.png            ← Speaker photo
│   │   ├── jared-mellinger.png         ← Speaker photo
│   │   ├── walt-alexander.png          ← Speaker photo
│   │   └── david-zimmer.png            ← Worship leader photo
│   └── qr/
│       └── gcash-qr.png               ← GCash / BPI QR code for payment


## How to Update Each Image

### Hero Banner (hero.jpg)
- Replace with any JPG/PNG — recommended size: 2000×920px
- Keep filename as hero.jpg (or change extension and update index.html line: src="assets/images/hero.jpg")

### Speaker Photos (speakers/*.png)
- Square crop recommended (1:1 ratio), minimum 300×300px
- PNG or JPG both work — just keep the same filename
- To add/remove a speaker, edit the Speakers section in index.html

### GCash QR Code (qr/gcash-qr.png)
- Export your GCash or BPI QR code as a PNG
- Replace gcash-qr.png with your actual QR image
- Recommended size: 300×300px minimum, must be a square
- ⚠️ This is the most important one to replace before going live!
