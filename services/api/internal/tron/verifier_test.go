package tron

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

const testAddress = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
const testContract = "TBXSw8fM4jpQkGc6zZjsVABFpVN7UvXPdV"

func fixture() Receipt {
	a, _ := AddressHex(testAddress)
	c, _ := AddressHex(testContract)
	r := Receipt{ID: strings.Repeat("a", 64), BlockNumber: json.Number("123"), Logs: []Log{{Address: c, Topics: []string{transferTopic, strings.Repeat("0", 64), strings.Repeat("0", 24) + a}, Data: fmt.Sprintf("%064x", 1000000)}}}
	r.Receipt.Result = "SUCCESS"
	return r
}
func TestSolidifiedReceiptMatching(t *testing.T) {
	r := fixture()
	p, e := Match(r, r.ID, testContract, testAddress, "1000000")
	if e != nil || p.TransferIndex != "0" {
		t.Fatal(p, e)
	}
	r.Logs = append(r.Logs, r.Logs[0])
	if _, e = Match(r, r.ID, testContract, testAddress, "1000000"); e == nil {
		t.Fatal("ambiguous transfers accepted")
	}
	r = fixture()
	r.Receipt.Result = "REVERT"
	if _, e = Match(r, r.ID, testContract, testAddress, "1000000"); e == nil {
		t.Fatal("failed execution accepted")
	}
	r = fixture()
	r.Logs = append([]Log{{}}, r.Logs...)
	p, e = Match(r, r.ID, testContract, testAddress, "1000000")
	if e != nil || p.TransferIndex != "1" {
		t.Fatal(p, e)
	}
	if _, e = Match(r, r.ID, testAddress, testAddress, "1000000"); e == nil {
		t.Fatal("wrong contract accepted")
	}
	if _, e = Match(r, r.ID, testContract, testAddress, "1000001"); e == nil {
		t.Fatal("wrong amount accepted")
	}
}
func TestNodeConfigurationAndAddress(t *testing.T) {
	for _, u := range []string{"http://node.example", "https://x@y", "https://node.example/?key=secret", "https://node.example/path"} {
		if _, e := New(u, ""); e == nil {
			t.Fatal(u)
		}
	}
	if _, e := AddressHex(testAddress); e != nil {
		t.Fatal(e)
	}
	if _, e := AddressHex(testAddress[:33] + "c"); e == nil {
		t.Fatal("checksum accepted")
	}
}
