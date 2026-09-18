package issuing

import (
	"crypto/rand"
	"math/big"
)

// Internal display aliases, never cardholder identities or ownership evidence.
// Reuse across cards is allowed; the order/card ID remains the unique identity.
var cardNames = [...]string{
	"James Anderson", "Olivia Bennett", "William Carter", "Emma Davis", "Benjamin Edwards",
	"Charlotte Foster", "Lucas Graham", "Amelia Hayes", "Henry Irving", "Sophia James",
	"Alexander Knight", "Isabella Lewis", "Michael Morgan", "Mia Nelson", "Daniel Owens",
	"Evelyn Parker", "Matthew Quinn", "Harper Reed", "Joseph Scott", "Abigail Turner",
	"Samuel Brooks", "Emily Collins", "David Cooper", "Elizabeth Evans", "John Fisher",
	"Sofia Grant", "Owen Harris", "Avery Hughes", "Sebastian Jackson", "Ella Kelly",
	"Jack Lawson", "Scarlett Miller", "Theodore Moore", "Grace Murphy", "Aiden Palmer",
	"Chloe Pearson", "Gabriel Powell", "Victoria Price", "Julian Richardson", "Riley Russell",
	"Leo Sanders", "Aria Shaw", "Thomas Spencer", "Lily Stewart", "Isaac Sullivan",
	"Zoey Taylor", "Anthony Walker", "Nora Ward", "Dylan Watson", "Hannah White",
	"Andrew Wilson", "Stella Wood", "Joshua Wright", "Addison Young", "Nathan Bell",
	"Aubrey Blake", "Christopher Brown", "Ellie Chapman", "Caleb Clark", "Natalie Cole",
	"Ryan Dawson", "Leah Dixon", "Adrian Elliott", "Audrey Ellis", "Charles Fletcher",
	"Savannah Ford", "Christian Freeman", "Brooklyn Gibson", "Jonathan Gray", "Bella Griffin",
	"Aaron Hall", "Claire Hamilton", "Eli Harrison", "Skylar Hart", "Connor Harvey",
	"Lucy Henderson", "Cameron Hill", "Paisley Holmes", "Ethan Hudson", "Anna Hunt",
	"Luke Jenkins", "Caroline Johnson", "Noah Jordan", "Naomi Lane", "Liam Marshall",
	"Elena Mason", "Adam Mitchell", "Sarah Morris", "Ian Murray", "Alice Newman",
	"Evan Phillips", "Madeline Porter", "Miles Roberts", "Ruby Robinson", "Nolan Rogers",
	"Eva Simpson", "Austin Stevens", "Violet Thompson", "Cole Wallace", "Clara West",
}

func randomCardName() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(cardNames))))
	if err != nil {
		return "", err
	}
	return cardNames[n.Int64()], nil
}
