Feature: Deterministic storage-name normalization
  ADL derives safe, stable storage identifiers from model names.

  @TEST-0001 @AC-0001
  Scenario: TEST-0001 normal CamelCase names preserve word boundaries
    Given the declared name "PurchaseOrder"
    When I normalize it for storage
    Then the storage name is "purchase_order"

  @TEST-0002 @AC-0002
  Scenario: TEST-0002 separators canonicalize to one underscore
    Given the declared name " Purchase Order.Status---LineItem "
    When I normalize it for storage
    Then the storage name is "purchase_order_status_line_item"

  @TEST-0003 @AC-0003
  Scenario: TEST-0003 numeric-leading names gain a safe boundary
    Given the declared name "123 Value"
    When I normalize it for storage
    Then the storage name is "_123_value"

  @TEST-0004 @AC-0004
  Scenario: TEST-0004 punctuation-only names use the unusable-input fallback
    Given the declared name "!@#$%^&*"
    When I normalize it for storage
    Then the storage name is "unnamed"
