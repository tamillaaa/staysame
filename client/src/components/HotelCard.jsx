function HotelCard({ hotel }) {
  return (
    <div className="hotel-card">
      <img className="hotel-card-image" src={hotel.image} alt={hotel.name} />
      <div className="hotel-card-body">
        <h3 className="hotel-card-name">{hotel.name}</h3>
        <p className="hotel-card-location">{hotel.location}</p>
        <p className="hotel-card-description">{hotel.description}</p>
        <p className="hotel-card-price">{hotel.price}</p>
      </div>
    </div>
  );
}

export default HotelCard;
