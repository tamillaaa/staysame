function HotelCard({ hotel }) {
  return (
    <div className="hotel-card">
      <img className="hotel-card-image" src={hotel.imageUrl} alt={hotel.name} loading="lazy" />
      <div className="hotel-card-body">
        <h3 className="hotel-card-name">{hotel.name}</h3>
        <p className="hotel-card-location">{hotel.location}</p>
        <p className="hotel-card-description">{hotel.description}</p>
        {hotel.matchReason && <p className="hotel-card-match">{hotel.matchReason}</p>}
        <p className="hotel-card-price">{hotel.price}</p>
        {hotel.bookingUrl && (
          <a
            className="hotel-card-book"
            href={hotel.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Book this stay
          </a>
        )}
      </div>
    </div>
  );
}

export default HotelCard;
