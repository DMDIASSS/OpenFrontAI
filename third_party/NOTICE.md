# Provenance

`solo-aggrobot.user.js` is the user-provided **OpenFront Solo AggroBot**, userscript
metadata version 1.21.6 (internal VERSION 1.21.5), declaring MIT in its header.
It is retained unchanged. Original metadata names
https://update.greasyfork.org/scripts/599445/OpenFront%20Solo%20AggroBot.user.js
as the distribution source. No author or copyright holder was supplied in the
file; none is invented here. Preserve original notices when redistributing.

`browser/schema7.cjs` extracts its generated schema-7 feature encoder, validator,
and inference implementation unchanged, with a CommonJS export appended.
`openfront_ai/features.py` ports that encoder for compatible training.
The bundle command produces a clearly named local derivative, embeds the trained
model, adds a supported-action guard, and disables automatic start and update URLs.

The optional runtime engine is https://github.com/openfrontio/openfrontio at
`cd8f7c36a9c5dd658615828261106f24d8cfa60a`. It remains a separate ignored dependency
under `vendor/`, with its own AGPL-3.0 and additional attribution terms. Read its
LICENSE and LICENSING.md before redistributing any engine-derived work. No website
capture, payment/analytics scripts, or proprietary game assets are bundled here.
