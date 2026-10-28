Independent followup review: GO.27/27 tests and diff checks passed. Actual
reviewed Git blob SHA6fc4cddf… matches the retained public fixture. Fallback
requires exact known compact serialization AND SHA-match of the one reconstructed
two-space ASCII+newline representation with preserved key order. Mutations,
extra whitespace, reordered keys, duplicate fields, wrong source and wrong hashes
refuse. This binds exact reviewed bytes, not arbitrary semantic equivalence.
Historical private package/supervisor files are not rewritten; the export adds
identity provenance naming both hashes and the legacy representation.
