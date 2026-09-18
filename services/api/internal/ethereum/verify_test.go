package ethereum

import (
	"fmt"
	"strings"
	"testing"
)

func TestFinalizedTransfer(t *testing.T) {
	hash := "0x" + strings.Repeat("a", 64)
	block := "0x" + strings.Repeat("b", 64)
	contract := "0x" + strings.Repeat("1", 40)
	address := "0x" + strings.Repeat("2", 40)
	receipt := Receipt{Hash: hash, BlockHash: block, BlockNumber: "0x64", Status: "0x1", Logs: []Log{{Address: contract, Topics: []string{"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x" + strings.Repeat("0", 64), "0x" + strings.Repeat("0", 24) + address[2:]}, Data: fmt.Sprintf("0x%064x", 1000001), Index: "0x9", TransactionHash: hash, BlockHash: block}}}
	final := Block{Hash: block, Number: "0x65"}
	canonical := Block{Hash: block, Number: "0x64"}
	proof, e := Match(receipt, final, canonical, hash, contract, address, "1000001")
	if e != nil || proof.TransferIndex != "9" {
		t.Fatal(proof, e)
	}
	for _, name := range []string{"not-final", "reorg", "failed", "removed", "wrong-token", "ambiguous", "wrong-amount"} {
		t.Run(name, func(t *testing.T) {
			r := receipt
			r.Logs = append([]Log(nil), receipt.Logs...)
			f, c, token, amount := final, canonical, contract, "1000001"
			switch name {
			case "not-final":
				f.Number = "0x63"
			case "reorg":
				c.Hash = "0x" + strings.Repeat("c", 64)
			case "failed":
				r.Status = "0x0"
			case "removed":
				r.Logs[0].Removed = true
			case "wrong-token":
				token = address
			case "ambiguous":
				r.Logs = append(r.Logs, r.Logs[0])
			case "wrong-amount":
				amount = "1000000"
			}
			if _, e := Match(r, f, c, hash, token, address, amount); e == nil {
				t.Fatal("unverified credit accepted")
			}
		})
	}
}
