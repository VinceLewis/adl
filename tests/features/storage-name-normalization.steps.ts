import { Given, Then, When, setWorldConstructor } from "@cucumber/cucumber";
import { strict as assert } from "node:assert";
import { toStorageName } from "../../src/model/defaults.js";

class StorageNameWorld {
  declaredName = "";
  storageName = "";
}

setWorldConstructor(StorageNameWorld);

Given("the declared name {string}", function (this: StorageNameWorld, name: string) {
  this.declaredName = name;
});

When("I normalize it for storage", function (this: StorageNameWorld) {
  this.storageName = toStorageName(this.declaredName);
});

Then("the storage name is {string}", function (this: StorageNameWorld, expected: string) {
  assert.equal(this.storageName, expected);
});
