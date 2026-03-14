import CoreLocation
import Foundation
import MapKit

enum AudienceBand: String, CaseIterable, Identifiable {
    case elementary
    case earlyElementary
    case adult

    var id: String { rawValue }

    var title: String {
        switch self {
        case .elementary:
            return "Elementary"
        case .earlyElementary:
            return "Early Elementary"
        case .adult:
            return "Adult"
        }
    }
}

enum NarrationMode: String, CaseIterable, Identifiable {
    case storyteller
    case quickFacts
    case history

    var id: String { rawValue }

    var title: String {
        switch self {
        case .storyteller:
            return "Storyteller"
        case .quickFacts:
            return "Quick Facts"
        case .history:
            return "History"
        }
    }
}

struct TripSettings: Equatable {
    var tripName: String = "Road Trip"
    var audienceBand: AudienceBand = .adult
    var narrationMode: NarrationMode = .storyteller
    var speakAloud: Bool = true
    var saveHistory: Bool = true
    var llmModelOverride: String = ""
}

struct PlaceSummary: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var region: String
    var coordinate: CLLocationCoordinate2D
    var detail: String

    static func == (lhs: PlaceSummary, rhs: PlaceSummary) -> Bool {
        lhs.id == rhs.id &&
        lhs.name == rhs.name &&
        lhs.region == rhs.region &&
        lhs.coordinate.latitude == rhs.coordinate.latitude &&
        lhs.coordinate.longitude == rhs.coordinate.longitude &&
        lhs.detail == rhs.detail
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
        hasher.combine(name)
        hasher.combine(region)
        hasher.combine(coordinate.latitude)
        hasher.combine(coordinate.longitude)
        hasher.combine(detail)
    }
}

struct PointOfInterestSummary: Identifiable, Hashable {
    let id = UUID()
    var name: String
    var category: String
    var coordinate: CLLocationCoordinate2D
    var detail: String

    static func == (lhs: PointOfInterestSummary, rhs: PointOfInterestSummary) -> Bool {
        lhs.id == rhs.id &&
        lhs.name == rhs.name &&
        lhs.category == rhs.category &&
        lhs.coordinate.latitude == rhs.coordinate.latitude &&
        lhs.coordinate.longitude == rhs.coordinate.longitude &&
        lhs.detail == rhs.detail
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
        hasher.combine(name)
        hasher.combine(category)
        hasher.combine(coordinate.latitude)
        hasher.combine(coordinate.longitude)
        hasher.combine(detail)
    }
}

struct NarrationEvent: Identifiable, Hashable {
    let id = UUID()
    var title: String
    var script: String
    var timestamp: Date
    var coordinate: CLLocationCoordinate2D
    var sourceName: String

    static func == (lhs: NarrationEvent, rhs: NarrationEvent) -> Bool {
        lhs.id == rhs.id &&
        lhs.title == rhs.title &&
        lhs.script == rhs.script &&
        lhs.timestamp == rhs.timestamp &&
        lhs.coordinate.latitude == rhs.coordinate.latitude &&
        lhs.coordinate.longitude == rhs.coordinate.longitude &&
        lhs.sourceName == rhs.sourceName
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
        hasher.combine(title)
        hasher.combine(script)
        hasher.combine(timestamp)
        hasher.combine(coordinate.latitude)
        hasher.combine(coordinate.longitude)
        hasher.combine(sourceName)
    }
}

struct TripSnapshot {
    var anchorCoordinate: CLLocationCoordinate2D
    var currentPlace: PlaceSummary
    var nearbyTowns: [PlaceSummary]
    var nearbyPOIs: [PointOfInterestSummary]
}

enum MapSelectionItem: Identifiable, Hashable {
    case currentPlace(PlaceSummary)
    case nearbyTown(PlaceSummary)
    case poi(PointOfInterestSummary)

    var id: String {
        switch self {
        case .currentPlace(let place):
            return "current-\(place.name)-\(place.region)"
        case .nearbyTown(let place):
            return "town-\(place.name)-\(place.region)"
        case .poi(let poi):
            return "poi-\(poi.name)-\(poi.category)"
        }
    }

    var title: String {
        switch self {
        case .currentPlace(let place):
            return place.name
        case .nearbyTown(let place):
            return place.name
        case .poi(let poi):
            return poi.name
        }
    }

    var subtitle: String {
        switch self {
        case .currentPlace(let place):
            return place.region
        case .nearbyTown(let place):
            return place.region
        case .poi(let poi):
            return poi.category
        }
    }

    var coordinate: CLLocationCoordinate2D {
        switch self {
        case .currentPlace(let place):
            return place.coordinate
        case .nearbyTown(let place):
            return place.coordinate
        case .poi(let poi):
            return poi.coordinate
        }
    }

    var detail: String {
        switch self {
        case .currentPlace(let place):
            return place.detail
        case .nearbyTown(let place):
            return place.detail
        case .poi(let poi):
            return poi.detail
        }
    }

    var kindLabel: String {
        switch self {
        case .currentPlace:
            return "current_place"
        case .nearbyTown:
            return "nearby_town"
        case .poi:
            return "point_of_interest"
        }
    }
}
