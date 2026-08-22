Feature: Declared surfaces in the running application

  @TEST-0005 @AC-0005
  Scenario: TEST-0005 the navigation drawer offers the declared surfaces
    Given the runtime demo is open on production files
    When the navigation drawer is opened
    Then the drawer offers the "UserList" surface
    And the drawer offers the "PurchaseOrderList" surface

  @TEST-0006 @AC-0006
  Scenario: TEST-0006 opening a list surface shows that object's declared columns
    Given the runtime demo is open on production files
    When the "PurchaseOrderList" surface is opened
    Then the surface heading is "Purchase Order"
    And the surface lists the columns "PONumber, Supplier, Value, Status"
    And the "PurchaseOrderList" surface is the active one
