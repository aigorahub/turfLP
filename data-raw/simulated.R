# Make the simulated example data sets: icecream, chips, and cafe.
#
# Each data set comes from a latent class model. Every respondent belongs to
# one segment, and each segment likes some groups of products more than
# others. A respondent's latent liking of a product is
#
#   product mean + segment effect for the product's group
#     + respondent scale bias + noise.
#
# The segment effects make products in the same group correlated, as in
# real consumer data. The latent liking is then turned into the response
# scale of the data set.
#
# Run from the package root: Rscript data-raw/simulated.R

simulate_liking <- function(n, products, segments, bias_sd, noise_sd) {
  seg <- sample(names(segments$share), n, replace = TRUE,
                prob = segments$share)
  effect <- segments$effect[seg, products$group, drop = FALSE]
  base <- matrix(products$mean, n, nrow(products), byrow = TRUE)
  bias <- stats::rnorm(n, sd = bias_sd)
  noise <- matrix(stats::rnorm(n * nrow(products), sd = noise_sd), n)
  liking <- base + effect + bias + noise
  dimnames(liking) <- list(NULL, products$name)
  liking
}

to_scale <- function(liking, points) {
  out <- round(liking)
  out[out < 1] <- 1
  out[out > points] <- points
  storage.mode(out) <- "integer"
  as.data.frame(out, optional = TRUE)
}

# icecream: 120 consumers rate 10 flavors on the 9-point hedonic scale.
set.seed(2021)
icecream_products <- data.frame(
  name = c("Vanilla", "Chocolate", "Strawberry", "Mint chip",
           "Cookie dough", "Salted caramel", "Pistachio", "Coffee",
           "Mango sorbet", "Rocky road"),
  group = c("classic", "chocolate", "fruit", "chocolate", "chocolate",
            "sweet", "nutty", "nutty", "fruit", "chocolate"),
  mean = c(6.8, 6.9, 6.3, 6.1, 6.4, 6.5, 5.7, 5.5, 5.9, 6.0)
)
icecream_segments <- list(
  share = c(traditional = 0.35, chocoholic = 0.30, fruity = 0.20,
            adventurous = 0.15),
  effect = rbind(
    traditional = c(classic = 1.2, chocolate = 0.2, fruit = -0.3,
                    sweet = 0.3, nutty = -0.8),
    chocoholic = c(classic = -0.3, chocolate = 1.8, fruit = -1.2,
                   sweet = 0.8, nutty = -0.4),
    fruity = c(classic = 0.0, chocolate = -1.3, fruit = 2.0,
               sweet = -0.5, nutty = -0.2),
    adventurous = c(classic = -1.2, chocolate = 0.0, fruit = 0.4,
                    sweet = 0.8, nutty = 2.0)
  )
)
icecream <- to_scale(
  simulate_liking(120, icecream_products, icecream_segments,
                  bias_sd = 0.7, noise_sd = 1.4),
  points = 9
)

# chips: 600 consumers give purchase intent for 24 potato chip flavors on a
# 5-point scale.
set.seed(2022)
chips_products <- data.frame(
  name = c("Sea salt", "Salt and vinegar", "Barbecue",
           "Sour cream and onion", "Cheddar", "Jalapeno", "Dill pickle",
           "Honey mustard", "Ranch", "Sweet chili", "Truffle", "Wasabi",
           "Lime", "Buffalo", "Black pepper", "Balsamic", "Garlic parmesan",
           "Chipotle", "Smoked paprika", "Ketchup", "Kimchi", "Masala",
           "Everything bagel", "Hot honey"),
  group = c("classic", "tangy", "classic", "classic", "cheesy", "spicy",
            "tangy", "sweet", "cheesy", "sweet", "gourmet", "spicy",
            "tangy", "spicy", "gourmet", "tangy", "cheesy", "spicy",
            "gourmet", "sweet", "gourmet", "spicy", "gourmet", "sweet"),
  mean = c(3.3, 2.8, 3.1, 3.0, 2.9, 2.5, 2.4, 2.5, 2.8, 2.6, 2.2, 2.0,
           2.4, 2.4, 2.5, 2.2, 2.6, 2.4, 2.3, 2.0, 1.9, 2.1, 2.2, 2.4)
)
chips_segments <- list(
  share = c(classic = 0.35, heat = 0.20, tangy = 0.15, cheese = 0.15,
            foodie = 0.15),
  effect = rbind(
    classic = c(classic = 0.8, tangy = -0.2, cheesy = 0.2, spicy = -0.7,
                sweet = 0.0, gourmet = -0.6),
    heat = c(classic = -0.2, tangy = 0.0, cheesy = -0.1, spicy = 1.3,
             sweet = 0.3, gourmet = 0.1),
    tangy = c(classic = 0.0, tangy = 1.3, cheesy = -0.3, spicy = 0.0,
              sweet = -0.4, gourmet = 0.0),
    cheese = c(classic = 0.2, tangy = -0.4, cheesy = 1.3, spicy = -0.2,
               sweet = 0.2, gourmet = -0.1),
    foodie = c(classic = -0.5, tangy = 0.2, cheesy = 0.0, spicy = 0.3,
               sweet = 0.0, gourmet = 1.4)
  )
)
chips <- to_scale(
  simulate_liking(600, chips_products, chips_segments,
                  bias_sd = 0.45, noise_sd = 0.8),
  points = 5
)

# cafe: 2500 customers mark which of 40 drinks they would order. A customer
# would order a drink when the latent liking is above 0.
set.seed(2023)
cafe_products <- data.frame(
  name = c("Espresso", "Americano", "Drip coffee", "Cold brew",
           "Cappuccino", "Latte", "Flat white", "Cortado", "Mocha",
           "Caramel macchiato", "Vanilla latte", "Iced latte",
           "Pumpkin spice latte", "Frappe", "Affogato", "Black tea",
           "Earl Grey", "Green tea", "Chamomile", "Peppermint tea",
           "Chai latte", "Matcha latte", "London fog", "Iced tea",
           "Hot chocolate", "White hot chocolate", "Steamed milk",
           "Strawberry smoothie", "Mango smoothie", "Green smoothie",
           "Acai bowl smoothie", "Protein shake", "Fresh orange juice",
           "Lemonade", "Sparkling water", "Kombucha", "Ginger shot",
           "Italian soda", "Golden milk", "Oat milk latte"),
  group = c("coffee", "coffee", "coffee", "coffee", "milk_coffee",
            "milk_coffee", "milk_coffee", "coffee", "sweet_coffee",
            "sweet_coffee", "sweet_coffee", "milk_coffee", "sweet_coffee",
            "sweet_coffee", "sweet_coffee", "tea", "tea", "tea", "tea",
            "tea", "tea_latte", "tea_latte", "tea_latte", "cold",
            "chocolate", "chocolate", "chocolate", "smoothie", "smoothie",
            "health", "smoothie", "health", "cold", "cold", "cold",
            "health", "health", "cold", "tea_latte", "milk_coffee"),
  mean = c(-1.6, -1.2, -1.0, -1.3, -0.9, -0.6, -1.4, -1.8, -1.3, -1.2,
           -1.1, -1.0, -1.8, -1.5, -2.2, -1.8, -2.0, -1.7, -2.1, -2.2,
           -1.5, -1.7, -2.3, -1.6, -1.5, -2.2, -2.8, -1.8, -1.7, -2.3,
           -2.4, -2.4, -1.7, -1.8, -2.0, -2.4, -2.8, -2.4, -2.6, -1.7)
)
cafe_groups <- c("coffee", "milk_coffee", "sweet_coffee", "tea",
                 "tea_latte", "chocolate", "smoothie", "health", "cold")
cafe_segments <- list(
  share = c(purist = 0.20, everyday = 0.30, sweet_tooth = 0.18,
            tea = 0.14, wellness = 0.12, family = 0.06),
  effect = rbind(
    purist = c(1.9, 0.7, -0.8, -0.4, -0.6, -1.0, -1.0, -0.6, -0.5),
    everyday = c(0.5, 1.5, 0.4, -0.5, 0.0, -0.4, -0.4, -0.8, -0.2),
    sweet_tooth = c(-0.9, 0.4, 1.9, -0.8, 0.5, 1.0, 0.4, -1.2, 0.6),
    tea = c(-1.2, -0.3, -0.5, 2.1, 1.4, -0.4, -0.2, 0.4, 0.1),
    wellness = c(-0.6, -0.2, -1.2, 0.8, 0.6, -1.2, 1.4, 2.0, 0.5),
    family = c(-2.5, -1.3, 0.3, -1.0, -0.5, 2.3, 1.6, -0.5, 1.3)
  )
)
colnames(cafe_segments$effect) <- cafe_groups
cafe_liking <- simulate_liking(2500, cafe_products, cafe_segments,
                               bias_sd = 0.6, noise_sd = 1.0)
cafe <- as.data.frame(1L * (cafe_liking > 0), optional = TRUE)

usethis::use_data(icecream, chips, cafe, overwrite = TRUE, compress = "xz")
