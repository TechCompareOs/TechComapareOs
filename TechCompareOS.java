/*
 * File:    TechCompareOS.java
 * Author:  NextGen Innovators (TUT JGA 2026)
 * Date:    11 October 2026
 * Purpose: Menu-driven prototype of TechCompare OS, the campus platform for
 *          buying, selling and trading in used study devices. It follows the
 *          pseudocode in the Phase 1 report: device details, trade-in estimate,
 *          pricing check, marketplace sale, price alert and search, seller
 *          ratings and profile, and listing management.
 *
 * Variable names follow the pseudocode prefixes:
 *   s = String, r = decimal (double), i = integer.
 * Money uses double, as required by the project guide.
 */

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Scanner;

public class TechCompareOS {

    // ===== Parameters: fixed values the program relies on =====
    static final double TRADE_IN_RATE_PER_MONTH = 0.1;  // share of value lost per month of age (pseudocode formula)
    static final double COMMISSION_RATE = 0.05;         // 5% commission on a completed sale (Phase 1 report)
    static final double TRUSTED_SELLER_RATING = 4.0;    // average rating needed for the "Trusted Seller" badge
    static final double MAX_AMOUNT = 1000000;           // largest rand amount accepted
    static final int MAX_AGE_MONTHS = 120;              // oldest device age accepted
    static final int MAX_ID = Integer.MAX_VALUE;        // student numbers fit in an int
    static final int LISTING_DAYS = 30;                 // a listing stays live this long unless the seller renews it

    static final String[] CATEGORIES = {"Laptop", "Phone", "Tablet"};
    static final String[] CONDITIONS = {"Good", "Fair", "Poor"};
    static final String[] ALERT_OPTIONS = {"Enabled", "Disabled"};
    static final String[] YES_NO = {"Yes", "No"};

    static final Scanner input = new Scanner(System.in);

    // ===== Variables shared between menu options =====
    static String sDeviceId = "";
    static String sDeviceName = "";
    static String sDeviceCategory = "";
    static String sBrand = "";
    static String sListingStatus = "";   // "" = not listed yet, then "Available" or "Sold"
    static String sDateListed = "";      // yyyy-MM-dd
    static double rListingPrice = 0;
    static double rBudget = 0;
    static int iBuyerId = 0;

    // sellerRatingHistory[sellerId] and sellerCommentHistory[sellerId] from the pseudocode
    static final Map<Integer, ArrayList<Double>> sellerRatingHistory = new HashMap<>();
    static final Map<Integer, ArrayList<String>> sellerCommentHistory = new HashMap<>();

    // ===== Main program: show the menu until the user chooses Exit =====
    public static void main(String[] args) {
        int iMenuChoice;
        do {
            showMenu();
            iMenuChoice = readInt("Choose an option (1-9): ", 1, 9);
            runOption(iMenuChoice);
        } while (iMenuChoice != 9);

        System.out.println("Thank you for using TechCompare OS");
    }

    static void showMenu() {
        System.out.println();
        System.out.println("===== TechCompare OS =====");
        System.out.println("1. Seller: Enter device details");
        System.out.println("2. Seller: Trade-in estimate and listing price");
        System.out.println("3. Buyer: Pricing check (budget and net cost)");
        System.out.println("4. Marketplace: Process a sale");
        System.out.println("5. Buyer: Price alert and search");
        System.out.println("6. Buyer: Rate a seller");
        System.out.println("7. View a seller profile");
        System.out.println("8. Listing management");
        System.out.println("9. Exit");
    }

    // Each menu option calls its own method
    static void runOption(int iMenuChoice) {
        switch (iMenuChoice) {
            case 1: enterDeviceDetails(); break;
            case 2: estimateTradeIn(); break;
            case 3: checkPricing(); break;
            case 4: processSale(); break;
            case 5: managePriceAlertAndSearch(); break;
            case 6: rateSeller(); break;
            case 7: showSellerProfile(); break;
            case 8: manageListing(); break;
            default: break; // 9 = Exit, handled by the loop in main
        }
    }

    // ===== SELLER SECTION =====

    // Device identification
    static void enterDeviceDetails() {
        System.out.println("\n--- Seller: Device Details ---");
        sDeviceId = readText("Enter Device ID: ", 20);
        sDeviceName = readText("Enter Device Name: ", 60);
        sDeviceCategory = readChoice("Enter Device Category (Laptop/Phone/Tablet): ", CATEGORIES);
        sBrand = readText("Enter Brand: ", 30);

        // A new device starts a fresh listing
        sListingStatus = "";
        sDateListed = "";
        rListingPrice = 0;

        System.out.println("Device Details: " + sDeviceId + ", " + sDeviceName + ", "
                + sDeviceCategory + ", " + sBrand);
    }

    // Trade-in estimate, then the seller sets a listing price and publishes
    static void estimateTradeIn() {
        if (sDeviceId.isEmpty()) {
            System.out.println("Please enter the device details first (option 1).");
            return;
        }
        System.out.println("\n--- Seller: Trade-In Estimate ---");
        double rOriginalPrice = readDouble("Enter Original Price (R): ", 0.01, MAX_AMOUNT);
        int iAge = readInt("Enter Age (months): ", 0, MAX_AGE_MONTHS);
        String sCondition = readChoice("Enter Condition (Good/Fair/Poor): ", CONDITIONS);

        double rTradeInValue = calculateTradeInValue(rOriginalPrice, iAge, sCondition);
        System.out.println("Estimated Trade-In Value: " + formatRand(rTradeInValue));

        // The listing price defaults to the trade-in value, but the seller may change it
        Double defaultPrice = rTradeInValue > 0 ? rTradeInValue : null;
        String hint = rTradeInValue > 0 ? " or press Enter to use " + formatRand(rTradeInValue) : "";
        rListingPrice = readDoubleOrDefault("Enter Listing Price (R)" + hint + ": ", 0.01, MAX_AMOUNT, defaultPrice);

        sListingStatus = "Available";
        sDateListed = LocalDate.now().toString();
        System.out.println("Listing published at " + formatRand(rListingPrice) + ". Status: " + sListingStatus);
    }

    // tradeInValue = originalPrice - (originalPrice * age * 0.1), scaled by condition
    static double calculateTradeInValue(double rOriginalPrice, int iAge, String sCondition) {
        double rValue = rOriginalPrice - (rOriginalPrice * iAge * TRADE_IN_RATE_PER_MONTH);
        rValue = Math.max(0, rValue); // an old device cannot be worth less than nothing
        return rValue * conditionFactor(sCondition);
    }

    static double conditionFactor(String sCondition) {
        if (sCondition.equals("Good")) {
            return 1.0;
        } else if (sCondition.equals("Fair")) {
            return 0.8;
        }
        return 0.5; // Poor
    }

    // ===== BUYER SECTION =====

    // Pricing logic: affordability and net cost
    static void checkPricing() {
        if (!isListed()) {
            return;
        }
        System.out.println("\n--- Buyer: Pricing Check ---");
        System.out.println("Listing price: " + formatRand(rListingPrice));
        rBudget = readDouble("Enter your Budget (R): ", 0.01, MAX_AMOUNT);

        double rDefaultFee = rListingPrice * COMMISSION_RATE;
        double rCommissionFee = readDoubleOrDefault(
                "Enter Commission Fee (R) or press Enter for 5% (" + formatRand(rDefaultFee) + "): ",
                0, MAX_AMOUNT, rDefaultFee);

        if (rListingPrice <= rBudget) {
            System.out.println("Affordable");
        } else {
            System.out.println("Not Affordable");
        }
        double rNetCost = rListingPrice + rCommissionFee;
        System.out.println("Net cost: " + formatRand(rNetCost));
    }

    // Marketplace interaction: sell the listing if it is still available
    static void processSale() {
        if (!isListed()) {
            return;
        }
        System.out.println("\n--- Marketplace: Process a Sale ---");
        int iSellerId = readInt("Enter Seller ID: ", 1, MAX_ID);
        iBuyerId = readInt("Enter Buyer ID: ", 1, MAX_ID);

        if (iSellerId == iBuyerId) {
            System.out.println("A seller cannot buy their own listing.");
            iBuyerId = 0;
            return;
        }
        if (sListingStatus.equals("Available")) {
            System.out.println("Sale processed between Buyer " + iBuyerId + " and Seller " + iSellerId);
            sListingStatus = "Sold";
        } else {
            System.out.println("Not Available");
        }
    }

    // Price alert and keyword search
    static void managePriceAlertAndSearch() {
        System.out.println("\n--- Buyer: Price Alert and Search ---");
        if (rBudget == 0) {
            rBudget = readDouble("Enter your Budget (R): ", 0.01, MAX_AMOUNT);
        }
        if (iBuyerId == 0) {
            iBuyerId = readInt("Enter Buyer ID: ", 1, MAX_ID);
        }
        String sPriceAlert = readChoice("Enable Price Alert? (Enabled/Disabled): ", ALERT_OPTIONS);
        double rCurrentPrice = readDouble("Enter Current Price (R): ", 0.01, MAX_AMOUNT);

        String sNotificationStatus = "Not sent";
        if (sPriceAlert.equals("Enabled") && rCurrentPrice <= rBudget) {
            sNotificationStatus = "Sent";
            System.out.println("Notification sent to Buyer " + iBuyerId);
        }
        System.out.println("Notification status: " + sNotificationStatus);

        String sSearchKeyword = readText("Enter Search Keyword: ", 40);
        System.out.println("Search results for " + sSearchKeyword);
    }

    // ===== QUALITY AND TRUST: seller ratings, comments and profile =====

    static void rateSeller() {
        System.out.println("\n--- Buyer: Rate a Seller ---");
        int iSellerId = readInt("Enter Seller ID: ", 1, MAX_ID);
        double rRating = readDouble("Rate this seller (1.0 - 5.0): ", 1.0, 5.0);
        String sComment = readText("Leave a comment about this seller: ", 200);

        // APPEND to the seller's histories
        sellerRatingHistory.computeIfAbsent(iSellerId, id -> new ArrayList<>()).add(rRating);
        sellerCommentHistory.computeIfAbsent(iSellerId, id -> new ArrayList<>()).add(sComment);

        double rAverageRating = calculateAverage(sellerRatingHistory.get(iSellerId));
        System.out.println("Thank you. Seller " + iSellerId + " now has an average rating of "
                + String.format(Locale.US, "%.1f", rAverageRating) + " / 5.0");
        if (rAverageRating >= TRUSTED_SELLER_RATING) {
            System.out.println("Trusted Seller");
        }
    }

    static void showSellerProfile() {
        System.out.println("\n--- Seller Profile ---");
        int iSellerId = readInt("Enter Seller ID: ", 1, MAX_ID);

        if (!sellerRatingHistory.containsKey(iSellerId)) {
            System.out.println("Seller " + iSellerId + " has no ratings yet.");
            return;
        }
        double rAverageRating = calculateAverage(sellerRatingHistory.get(iSellerId));

        System.out.println("----- Seller Profile: " + iSellerId + " -----");
        System.out.println("Average Rating: " + String.format(Locale.US, "%.1f", rAverageRating) + " / 5.0");
        if (rAverageRating >= TRUSTED_SELLER_RATING) {
            System.out.println("Trusted Seller");
        }
        System.out.println("Comments:");
        for (String sComment : sellerCommentHistory.get(iSellerId)) {
            System.out.println(" - " + sComment);
        }
    }

    static double calculateAverage(ArrayList<Double> ratings) {
        double rTotal = 0;
        for (double rRating : ratings) {
            rTotal += rRating;
        }
        return rTotal / ratings.size();
    }

    // ===== LISTING MANAGEMENT =====

    // listingAge = CurrentDate - dateListed (in days)
    static void manageListing() {
        if (!isListed()) {
            return;
        }
        System.out.println("\n--- Listing Management ---");
        LocalDate today = LocalDate.now();
        LocalDate dateListed = readDate(
                "Enter date listed (yyyy-MM-dd) or press Enter for " + sDateListed + ": ",
                LocalDate.parse(sDateListed), today);

        sDateListed = dateListed.toString();
        int iListingAge = (int) ChronoUnit.DAYS.between(dateListed, today);
        System.out.println("Listing status: " + sListingStatus + ", listing age: " + iListingAge + " day(s)");
        checkExpiry(iListingAge);
    }

    // A listing stays live for 30 days; after that it is hidden until the seller renews it
    static void checkExpiry(int iListingAge) {
        if (sListingStatus.equals("Sold")) {
            return; // a sold listing is already hidden, so it cannot expire
        }
        int iDaysLeft = LISTING_DAYS - iListingAge;
        if (iDaysLeft > 0) {
            System.out.println("Expires in " + iDaysLeft + " day(s).");
            return;
        }
        System.out.println("This listing has expired and is hidden from the marketplace.");
        String sRenew = readChoice("Renew it for " + LISTING_DAYS + " days? (Yes/No): ", YES_NO);
        if (sRenew.equals("Yes")) {
            sDateListed = LocalDate.now().toString();
            System.out.println("Listing renewed. It is live again for " + LISTING_DAYS + " days.");
        }
    }

    // A listing must exist (option 2) before pricing, sales or management
    static boolean isListed() {
        if (sListingStatus.isEmpty()) {
            System.out.println("There is no listing yet. Please complete options 1 and 2 first.");
            return false;
        }
        return true;
    }

    // ===== INPUT HELPERS: every prompt repeats until the answer is valid =====

    static String readLine(String sPrompt) {
        System.out.print(sPrompt);
        if (!input.hasNextLine()) {
            System.out.println("\nInput ended. Goodbye.");
            System.exit(0);
        }
        return input.nextLine().trim();
    }

    static int readInt(String sPrompt, int iMin, int iMax) {
        while (true) {
            String sText = readLine(sPrompt);
            int iValue;
            try {
                iValue = Integer.parseInt(sText);
            } catch (NumberFormatException e) {
                System.out.println("Please enter a whole number, for example 3.");
                continue;
            }
            if (iValue >= iMin && iValue <= iMax) {
                return iValue;
            }
            System.out.println("Please enter a number between " + iMin + " and " + iMax + ".");
        }
    }

    static double readDouble(String sPrompt, double rMin, double rMax) {
        return readDoubleOrDefault(sPrompt, rMin, rMax, null);
    }

    // If a default is given, pressing Enter on its own accepts it
    static double readDoubleOrDefault(String sPrompt, double rMin, double rMax, Double rDefault) {
        while (true) {
            String sText = readLine(sPrompt);
            if (sText.isEmpty() && rDefault != null) {
                return rDefault;
            }
            double rValue;
            try {
                rValue = Double.parseDouble(sText.replace(',', '.')); // allow 1500,50 as well as 1500.50
            } catch (NumberFormatException e) {
                System.out.println("Please enter a number, for example 1500.50.");
                continue;
            }
            if (Double.isFinite(rValue) && rValue >= rMin && rValue <= rMax) {
                return rValue;
            }
            System.out.println("Please enter an amount between " + formatPlain(rMin) + " and " + formatPlain(rMax) + ".");
        }
    }

    static String readText(String sPrompt, int iMaxLength) {
        while (true) {
            String sText = readLine(sPrompt);
            if (!sText.isEmpty() && sText.length() <= iMaxLength) {
                return sText;
            }
            System.out.println("Please enter between 1 and " + iMaxLength + " characters.");
        }
    }

    // Returns the matching option written in its official spelling, ignoring upper/lower case
    static String readChoice(String sPrompt, String[] options) {
        while (true) {
            String sText = readLine(sPrompt);
            for (String sOption : options) {
                if (sOption.equalsIgnoreCase(sText)) {
                    return sOption;
                }
            }
            System.out.println("Please type one of: " + String.join(", ", options) + ".");
        }
    }

    static LocalDate readDate(String sPrompt, LocalDate defaultDate, LocalDate latest) {
        while (true) {
            String sText = readLine(sPrompt);
            if (sText.isEmpty()) {
                return defaultDate;
            }
            try {
                LocalDate date = LocalDate.parse(sText);
                if (!date.isAfter(latest)) {
                    return date;
                }
                System.out.println("The date cannot be in the future.");
            } catch (DateTimeParseException e) {
                System.out.println("Please use the format yyyy-MM-dd, for example 2026-09-15.");
            }
        }
    }

    // ===== Display helpers =====

    static String formatRand(double rAmount) {
        return "R" + String.format(Locale.US, "%,.2f", rAmount);
    }

    static String formatPlain(double rAmount) {
        return String.format(Locale.US, "%,.2f", rAmount);
    }
}
