---
status: accepted
---

# The DIN barcode encodes `=` + DIN + `00`, and the check character is eye-readable only

ICCBBA ST-001 section 2.4.1 defines Data Structure 001 as `=` followed by the 13-character DIN and two flag characters, 16 characters in all, and section 7.5 states that the check character K is not part of the data content. We encode exactly that, with flag characters `00`, and print K only in the eye-readable text inside a box.

This deliberately differs from an earlier in-house label tool, which encodes `=` + DIN + K in 15 characters. That form is non-compliant, and scanners feeding the blood establishment computer system carry a rule that appends a `0` to work around it. Replicas printed by this app must scan into that system without any scanner rule, the same as vendor DIN sets do.

## Consequences

- The scan parser accepts the compliant 16-character form, the 15-character legacy form, the 16-character form produced by the scanner rule, and a bare DIN, and normalizes all of them to the bare DIN before recomputing K.
- Test vectors come from ICCBBA IG-043 section 3.1.1, ST-001 appendix A, and a sample label scanned from a production system (`W483626000011`, K = N).
